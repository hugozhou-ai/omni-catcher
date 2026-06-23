import { createServiceIdentifier, type ILogService } from "@omni-catcher/shared/platform";
import type { Capture, CaptureSource, Classification, ConfirmEdits, ConfirmResult, Intent, Item } from "@omni-catcher/shared";
import type { AppConfig } from "../config.js";
import { captureId, nowIso } from "../util.js";
import type { IStorageService } from "./storageService.js";
import { INTENT_DIRS } from "./storageService.js";
import type { IClassificationService } from "./classificationService.js";
import type { IAgentService } from "./agentService.js";
import type { IIssueService } from "./issueService.js";

export interface ICaptureService {
  create(content: string, url: string, source: CaptureSource): Promise<Capture>;
  confirm(id: string, intent: string | undefined, writeIssue: boolean, edits: ConfirmEdits): Promise<ConfirmResult>;
}

export const ICaptureService = createServiceIdentifier<ICaptureService>("captureService");

const CLASSIFY_LOG_PREFIX = "capture-classify";

export class CaptureService implements ICaptureService {
  constructor(
    private readonly config: AppConfig,
    private readonly storage: IStorageService,
    private readonly classification: IClassificationService,
    private readonly agent: IAgentService,
    private readonly issues: IIssueService,
    private readonly log: ILogService,
  ) {}

  async create(content: string, url: string, source: CaptureSource): Promise<Capture> {
    let text = (content || "").trim();
    const link = (url || "").trim();
    if (!text && link) text = link;
    if (!text) throw new Error("content or url is required");
    const capture: Capture = {
      id: captureId(),
      status: "classifying",
      source,
      content: text,
      url: link,
      createdAt: nowIso(),
      rulePreview: this.classification.rulePreview(text, link),
      classification: null,
      agentSessionId: null,
      agentProvider: null,
      error: null,
    };
    await this.storage.writeCapture(capture);
    // Fire-and-forget background classification; UI polls for the result.
    void this.classify(capture.id);
    return capture;
  }

  private async classify(id: string): Promise<void> {
    let capture = await this.storage.readCapture(id);
    if (!capture) return;
    try {
      const settings = await this.storage.readSettings();
      const preferredProvider = String(settings.agentProvider || "").trim() || undefined;
      const relatedItems = await this.storage.findRelatedItems(capture.content);
      const prompt = await this.classification.classifyPrompt(capture.content, relatedItems);
      this.log.info(
        `${CLASSIFY_LOG_PREFIX} ${JSON.stringify({
          event: "start",
          id,
          contentLength: capture.content.length,
          promptLength: prompt.length,
          relatedCount: relatedItems.length,
          preferredProvider: preferredProvider || "",
        })}`,
      );
      const outcome = await this.agent.runPrompt(
        prompt,
        "Omni Catcher: classify",
        this.config.classifyTimeoutMs,
        preferredProvider,
      );
      const parsed = this.classification.parseStrictJson(outcome.text) as Record<string, unknown>;
      if (!parsed.source) parsed.source = "agent";
      capture = (await this.storage.readCapture(id)) || capture;
      capture.classification = withDeterministicMergePreview(
        this.classification.normalize(parsed, capture.content, relatedItems),
      );
      capture.agentSessionId = outcome.sessionId;
      capture.agentProvider = outcome.provider;
      capture.status = "classified";
      capture.error = null;
      this.log.info(
        `${CLASSIFY_LOG_PREFIX} ${JSON.stringify({
          event: "classified",
          id,
          sessionId: outcome.sessionId,
          provider: outcome.provider,
          intent: capture.classification.primaryIntent,
          confidence: capture.classification.confidence,
        })}`,
      );
    } catch (error) {
      this.log.warn(
        `${CLASSIFY_LOG_PREFIX} ${JSON.stringify({
          event: "failed",
          id,
          error: (error as Error).message,
        })}`,
      );
      capture = (await this.storage.readCapture(id)) || capture;
      const fallbackRaw = { ...capture.rulePreview, source: "rule-fallback" } as unknown as Record<string, unknown>;
      capture.classification = withDeterministicMergePreview(
        this.classification.normalize(fallbackRaw, capture.content, await this.storage.findRelatedItems(capture.content)),
      );
      capture.status = "needs_review";
      capture.error = (error as Error).message;
    }
    await this.storage.writeCapture(capture);
  }

  async confirm(
    id: string,
    intentOverride: string | undefined,
    writeIssue: boolean,
    edits: ConfirmEdits,
  ): Promise<ConfirmResult> {
    const capture = await this.storage.readCapture(id);
    if (!capture) throw new Error(`capture ${id} was not found`);
    const classification =
      capture.classification ||
      this.classification.normalize(
        { ...capture.rulePreview } as unknown as Record<string, unknown>,
        capture.content,
      );
    const intent = normalizeIntent(intentOverride) || normalizeIntent(classification.primaryIntent) || "note";
    const written: Item[] = [];
    if (intent === "mixed" && classification.items.length) {
      for (let index = 0; index < classification.items.length; index += 1) {
        const raw = classification.items[index]!;
        const subIntent = normalizeIntent(raw.type) || "note";
        const effective = subIntent === "mixed" ? "note" : subIntent;
        const subClass = {
          ...classification,
          title: raw.title || classification.title,
          summary: raw.summary || "",
          extractedUrls: raw.url ? [raw.url] : [],
          extractedTasks: Array.isArray(raw.tasks) ? raw.tasks : [],
        };
        const subContent = raw.summary || raw.url || capture.content;
        written.push(
          await this.storage.writeItem(effective, subClass, subContent, capture, edits, String(index + 1)),
        );
      }
      if (!written.length) {
        written.push(await this.storage.writeItem("note", classification, capture.content, capture, edits));
      }
    } else {
      const effective = (intent in INTENT_DIRS ? intent : "note") as Intent;
      const mergeTargetId = effective === "note" ? classification.mergePreview?.targetItemId : undefined;
      if (mergeTargetId) {
        written.push(await this.storage.mergeIntoItem(mergeTargetId, classification, capture.content, capture, edits));
      } else if (effective === "note" && shouldCreateMergePreviewNote(classification)) {
        written.push(
          await this.storage.writeItem(
            "note",
            classificationForMergePreviewNote(classification),
            mergePreviewNoteContent(classification, capture.content),
            capture,
            edits,
          ),
        );
      } else {
        written.push(await this.storage.writeItem(effective, classification, capture.content, capture, edits));
      }
    }
    let issue = null;
    if (writeIssue && intent === "todo") {
      const issueClassification = edits.title?.trim()
        ? { ...classification, title: edits.title.trim() }
        : classification;
      issue = await this.issues.createFromTodo(issueClassification, capture.content);
    }
    await this.storage.deleteCapture(id);
    return { items: written, issue };
  }
}

function shouldCreateMergePreviewNote(classification: Classification): boolean {
  const preview = classification.mergePreview;
  return Boolean(preview && !preview.targetItemId && preview.targetTitle && preview.insertedContent);
}

function classificationForMergePreviewNote(classification: Classification): Classification {
  const preview = classification.mergePreview;
  if (!preview || !preview.targetTitle) return classification;
  return {
    ...classification,
    title: preview.targetTitle,
    summary: classification.summary || preview.insertedContent,
  };
}

function mergePreviewNoteContent(classification: Classification, content: string): string {
  const preview = classification.mergePreview;
  if (!preview) return content;
  return [preview.existingContent, preview.insertedContent || content].filter(Boolean).join("\n\n").trim();
}

function withDeterministicMergePreview(classification: Classification): Classification {
  if (classification.mergePreview?.targetItemId || classification.primaryIntent !== "note") return classification;
  const exact = (classification.relatedItems || []).find(
    (item) => item.type === "note" && (item.reason === "same-url" || item.reason === "same-title"),
  );
  if (!exact) return classification;
  return {
    ...classification,
    mergePreview: {
      targetItemId: exact.id,
      targetTitle: exact.title,
      existingContent: exact.excerpt || exact.summary || exact.title,
      insertedContent: classification.summary || classification.title,
    },
  };
}

function normalizeIntent(value: unknown): Intent | "" {
  const v = String(value || "").trim().toLowerCase();
  return v === "note" || v === "bookmark" || v === "todo" || v === "mixed" ? (v as Intent) : "";
}
