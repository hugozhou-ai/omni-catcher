import { createServiceIdentifier, type ILogService } from "@omni-catcher/shared/platform";
import type {
  Capture,
  CaptureProgress,
  CaptureSource,
  Classification,
  ConfirmEdits,
  ConfirmResult,
  Intent,
  Item,
  MixedItem,
  SavePlan,
} from "@omni-catcher/shared";
import type { AppConfig } from "../config.js";
import { captureId, nowIso } from "../util.js";
import { resolveEffectiveSavePlan, withDeterministicSavePlan } from "../savePlanUtil.js";
import type { IStorageService } from "./storageService.js";
import { INTENT_DIRS } from "./storageService.js";
import type { IClassificationService } from "./classificationService.js";
import type { IAgentService } from "./agentService.js";
import type { IIssueService } from "./issueService.js";

export interface ICaptureService {
  create(content: string, url: string, source: CaptureSource): Promise<Capture>;
  list(): Promise<Capture[]>;
  read(id: string): Promise<Capture | null>;
  cancel(id: string): Promise<{ canceled: true; content: string }>;
  retry(id: string): Promise<Capture>;
  confirm(id: string, intent: string | undefined, writeIssue: boolean, edits: ConfirmEdits): Promise<ConfirmResult>;
}

export const ICaptureService = createServiceIdentifier<ICaptureService>("captureService");

const CLASSIFY_LOG_PREFIX = "capture-classify";
const CONFIRM_LOG_PREFIX = "capture-confirm";

interface ActiveRunState {
  canceled: boolean;
  latestActivity?: string;
  provider?: string;
  sessionId?: string;
}

export class CaptureService implements ICaptureService {
  private readonly activeRuns = new Map<string, ActiveRunState>();

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
      progress: "preparing",
    };
    await this.storage.writeCapture(capture);
    this.activeRuns.set(capture.id, { canceled: false });
    void this.classify(capture.id);
    return capture;
  }

  async list(): Promise<Capture[]> {
    return (await this.storage.listCaptures()).map((capture) => this.withTransientState(capture));
  }

  async read(id: string): Promise<Capture | null> {
    const capture = await this.storage.readCapture(id);
    return capture ? this.withTransientState(capture) : null;
  }

  async cancel(id: string): Promise<{ canceled: true; content: string }> {
    const capture = await this.storage.readCapture(id);
    if (!capture) throw new Error(`capture ${id} was not found`);
    const state = this.ensureActiveRun(id);
    state.canceled = true;
    const sessionId = state.sessionId || capture.agentSessionId || "";
    if (sessionId) {
      await this.agent.cancelSession(sessionId).catch((error) => {
        this.log.warn(
          `${CLASSIFY_LOG_PREFIX} ${JSON.stringify({
            event: "cancel-agent-failed",
            id,
            sessionId,
            error: (error as Error).message,
          })}`,
        );
      });
    }
    await this.storage.deleteCapture(id);
    this.log.info(
      `${CLASSIFY_LOG_PREFIX} ${JSON.stringify({
        event: "canceled",
        id,
        sessionId,
      })}`,
    );
    return { canceled: true, content: capture.content };
  }

  async retry(id: string): Promise<Capture> {
    const capture = await this.storage.readCapture(id);
    if (!capture) throw new Error(`capture ${id} was not found`);
    if (capture.status === "classifying") return this.withTransientState(capture);

    const next: Capture = {
      ...capture,
      status: "classifying",
      classification: null,
      agentSessionId: null,
      agentProvider: null,
      error: null,
      progress: "preparing",
    };
    await this.storage.writeCapture(next);
    this.activeRuns.set(id, { canceled: false, latestActivity: progressActivityText("preparing") });
    this.log.info(
      `${CLASSIFY_LOG_PREFIX} ${JSON.stringify({
        event: "retry",
        id,
        previousStatus: capture.status,
      })}`,
    );
    void this.classify(id);
    return this.withTransientState(next);
  }

  private async classify(id: string): Promise<void> {
    let capture = await this.storage.readCapture(id);
    if (!capture) return;
    try {
      try {
        const settings = await this.storage.readSettings();
        const preferredProvider = String(settings.agentProvider || "").trim() || undefined;
        await this.updateProgress(id, "finding_related");
        if (this.isCanceled(id)) return;
        const [relatedItems, existingTags] = await Promise.all([
          this.storage.findRelatedItems(capture.content),
          this.storage.listItems().then(collectExistingTags),
        ]);
        await this.updateProgress(id, "preparing_context");
        if (this.isCanceled(id)) return;
        const prompt = await this.classification.classifyPrompt(
          capture.content,
          relatedItems,
          existingTags,
          (progress) => this.updateProgress(id, progress),
        );
        if (this.isCanceled(id)) return;
        this.log.info(
          `${CLASSIFY_LOG_PREFIX} ${JSON.stringify({
            event: "start",
            id,
            contentLength: capture.content.length,
            promptLength: prompt.length,
            relatedCount: relatedItems.length,
            existingTagCount: existingTags.length,
            preferredProvider: preferredProvider || "",
            timeoutMs: this.config.classifyTimeoutMs,
          })}`,
        );
        await this.updateProgress(id, "calling_agent");
        const outcome = await this.agent.runPrompt(
          prompt,
          "Omni Catcher: classify",
          this.config.classifyTimeoutMs,
          preferredProvider,
          {
            isCanceled: () => this.isCanceled(id),
            onStarted: (sessionId, provider) => {
              const state = this.ensureActiveRun(id);
              state.sessionId = sessionId;
              state.provider = provider;
            },
            onActivity: (activityText) => {
              const state = this.ensureActiveRun(id);
              state.latestActivity = activityText;
            },
          },
        );
        if (this.isCanceled(id)) return;
        const parsed = this.classification.parseStrictJson(outcome.text) as Record<string, unknown>;
        if (!parsed.source) parsed.source = "agent";
        await this.updateProgress(id, "finalizing");
        if (this.isCanceled(id)) return;
        capture = (await this.storage.readCapture(id)) || capture;
        if (!capture || this.isCanceled(id)) return;
        capture.classification = withDeterministicSavePlan(
          this.classification.normalize(parsed, capture.content, relatedItems),
        );
        capture.agentSessionId = outcome.sessionId;
        capture.agentProvider = outcome.provider;
        capture.status = "classified";
        capture.error = null;
        delete capture.progress;
        this.log.info(
          `${CLASSIFY_LOG_PREFIX} ${JSON.stringify({
            event: "classified",
            id,
            sessionId: outcome.sessionId,
            provider: outcome.provider,
            intent: capture.classification.primaryIntent,
            confidence: capture.classification.confidence,
            saveMode: capture.classification.savePlan?.mode || "",
          })}`,
        );
      } catch (error) {
        if (this.isCanceled(id)) return;
        this.log.warn(
          `${CLASSIFY_LOG_PREFIX} ${JSON.stringify({
            event: "failed",
            id,
            error: (error as Error).message,
            sessionId: this.activeRuns.get(id)?.sessionId || "",
            provider: this.activeRuns.get(id)?.provider || "",
            timeoutMs: this.config.classifyTimeoutMs,
          })}`,
        );
        capture = (await this.storage.readCapture(id)) || capture;
        capture.progress = "fallback";
        const fallbackRaw = { ...capture.rulePreview, source: "rule-fallback" } as unknown as Record<string, unknown>;
        capture.classification = withDeterministicSavePlan(
          this.classification.normalize(
            fallbackRaw,
            capture.content,
            await this.storage.findRelatedItems(capture.content),
          ),
        );
        capture.status = "needs_review";
        capture.error = (error as Error).message;
      }
      if (!this.isCanceled(id)) await this.storage.writeCapture(capture);
    } finally {
      this.activeRuns.delete(id);
    }
  }

  private async updateProgress(id: string, progress: CaptureProgress): Promise<void> {
    if (this.isCanceled(id)) return;
    const capture = await this.storage.readCapture(id);
    if (!capture || capture.status !== "classifying") return;
    capture.progress = progress;
    const state = this.ensureActiveRun(id);
    if (progress !== "calling_agent") {
      state.latestActivity = progressActivityText(progress);
    }
    await this.storage.writeCapture(capture);
  }

  private ensureActiveRun(id: string): ActiveRunState {
    const existing = this.activeRuns.get(id);
    if (existing) return existing;
    const state: ActiveRunState = { canceled: false };
    this.activeRuns.set(id, state);
    return state;
  }

  private isCanceled(id: string): boolean {
    return Boolean(this.activeRuns.get(id)?.canceled);
  }

  private withTransientState(capture: Capture): Capture {
    const state = this.activeRuns.get(capture.id);
    if (!state?.latestActivity || capture.status !== "classifying") return capture;
    return { ...capture, activityText: state.latestActivity };
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
        written.push(
          await this.writeMixedItem(
            classification.items[index]!,
            classification,
            capture,
            edits,
            String(index + 1),
          ),
        );
      }
      if (!written.length) {
        written.push(await this.writeBySavePlan("note", classification, capture, edits));
      }
    } else {
      const effective = (intent in INTENT_DIRS ? intent : "note") as Intent;
      written.push(await this.writeBySavePlan(effective, classification, capture, edits));
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

  private async writeMixedItem(
    raw: MixedItem,
    classification: Classification,
    capture: Capture,
    edits: ConfirmEdits,
    suffix: string,
  ): Promise<Item> {
    const subIntent = normalizeIntent(raw.type) || "note";
    const effective = subIntent === "mixed" ? "note" : subIntent;
    const subClass: Classification = {
      ...classification,
      title: raw.title || classification.title,
      summary: raw.summary || "",
      tags: mergeTags(raw.tags, edits.tags || classification.tags),
      extractedUrls: raw.url ? [raw.url] : [],
      extractedTasks: Array.isArray(raw.tasks) ? raw.tasks : [],
      savePlan: raw.savePlan || null,
    };
    const splitEdits: ConfirmEdits = {
      ...edits,
      tags: mergeTags(raw.tags, edits.tags),
      bodyPreview: raw.savePlan?.bodyPreview || edits.bodyPreview,
      saveMode: raw.savePlan?.mode || edits.saveMode,
      targetItemId: raw.savePlan?.targetItemId || edits.targetItemId,
      insertHeading: raw.savePlan?.insertHeading || edits.insertHeading,
      ...(effective === "todo" ? { urgency: edits.urgency, importance: edits.importance } : {}),
    };
    const subContent = raw.summary || raw.url || capture.content;
    return this.writeBySavePlan(effective, subClass, { ...capture, content: subContent }, splitEdits, suffix);
  }

  private async writeBySavePlan(
    intent: Intent,
    classification: Classification,
    capture: Capture,
    edits: ConfirmEdits,
    suffix = "",
  ): Promise<Item> {
    const plan = resolveEffectiveSavePlan(classification, edits, intent);
    const planEdits: ConfirmEdits = {
      ...edits,
      bodyPreview: plan?.bodyPreview || edits.bodyPreview,
      insertHeading: plan?.insertHeading || edits.insertHeading,
      targetItemId: plan?.targetItemId || edits.targetItemId,
      saveMode: plan?.mode || edits.saveMode,
    };
    const enrichedClass =
      plan?.bodyPreview ?
        { ...classification, savePlan: plan }
      : classification;

    this.log.info(
      `${CONFIRM_LOG_PREFIX} ${JSON.stringify({
        event: "plan",
        captureId: capture.id,
        intent,
        mode: plan?.mode || "new",
        targetItemId: plan?.targetItemId || "",
        insertHeading: plan?.insertHeading || "",
        bodyPreviewLength: plan?.bodyPreview?.length || 0,
      })}`,
    );

    if (intent === "note" && plan?.mode === "merge" && plan.targetItemId) {
      const item = await this.storage.mergeIntoItem(
        plan.targetItemId,
        enrichedClass,
        capture.content,
        capture,
        planEdits,
      );
      this.log.info(
        `${CONFIRM_LOG_PREFIX} ${JSON.stringify({
          event: "merged",
          captureId: capture.id,
          targetItemId: plan.targetItemId,
          resultItemId: item.id,
          resultPath: item.path,
        })}`,
      );
      return item;
    }
    if (intent === "note" && plan?.mode === "collection") {
      if (plan.targetItemId) {
        const item = await this.storage.mergeIntoItem(
          plan.targetItemId,
          enrichedClass,
          capture.content,
          capture,
          planEdits,
        );
        this.log.info(
          `${CONFIRM_LOG_PREFIX} ${JSON.stringify({
            event: "collection-merged",
            captureId: capture.id,
            targetItemId: plan.targetItemId,
            resultItemId: item.id,
            resultPath: item.path,
          })}`,
        );
        return item;
      }
      const collectionClass: Classification = {
        ...enrichedClass,
        title: edits.title?.trim() || plan.targetTitle || enrichedClass.title,
        summary: enrichedClass.summary || plan.bodyPreview,
        savePlan: plan,
      };
      const body = plan.bodyPreview || collectionNoteContent(plan, capture.content);
      return this.storage.writeItem("note", collectionClass, body, capture, planEdits, suffix);
    }
    return this.storage.writeItem(intent, enrichedClass, capture.content, capture, planEdits, suffix);
  }
}

function collectionNoteContent(plan: SavePlan, content: string): string {
  const parts = [plan.bodyPreview].filter(Boolean);
  if (!plan.bodyPreview.includes(content.trim()) && content.trim()) {
    parts.push(`## Original\n${content.trim()}`);
  }
  return parts.join("\n\n").trim();
}

function normalizeIntent(value: unknown): Intent | "" {
  const v = String(value || "").trim().toLowerCase();
  return v === "note" || v === "bookmark" || v === "todo" || v === "mixed" ? (v as Intent) : "";
}

function mergeTags(left: unknown, right: unknown): string[] {
  const result: string[] = [];
  for (const source of [left, right]) {
    if (!Array.isArray(source)) continue;
    for (const value of source) {
      const tag = String(value || "").trim();
      if (tag && !result.includes(tag)) result.push(tag);
    }
  }
  return result.slice(0, 5);
}

function collectExistingTags(items: Item[]): string[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const item of items) {
    for (const rawTag of item.tags || []) {
      const tag = String(rawTag || "").trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      const current = counts.get(key);
      if (current) {
        current.count += 1;
      } else {
        counts.set(key, { tag, count: 1 });
      }
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 120)
    .map((entry) => `"${entry.tag}" (used ${entry.count} times)`);
}

function progressActivityText(progress: CaptureProgress): string {
  switch (progress) {
    case "preparing":
      return "Preparing content for classification";
    case "finding_related":
      return "Searching related saved notes and bookmarks";
    case "preparing_context":
      return "Building classification context";
    case "fetching_pages":
      return "Fetching linked page content";
    case "browser_pages":
      return "Analyzing pages in the browser";
    case "finalizing":
      return "Organizing classification results";
    case "fallback":
      return "Agent unavailable; using rule-based preview";
    default:
      return "";
  }
}
