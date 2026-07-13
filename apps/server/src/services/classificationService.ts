import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import type {
  AgentTaskResult,
  Classification,
  ClassificationIntent,
  MixedItem,
  RelatedItem,
} from "@omni-catcher/shared";
import type { AppConfig } from "../config.js";
import { extractUrls, firstNonemptyLine } from "../util.js";
import {
  normalizeSavePlan,
  syncMergePreviewFromSavePlan,
} from "../savePlanUtil.js";

export interface IClassificationService {
  rulePreview(content: string, url: string): Classification;
  agentPrompt(content: string): Promise<string>;
  normalizeAgentResult(parsed: Record<string, unknown>, content: string): AgentTaskResult;
  parseStrictJson(text: string): unknown;
  normalize(parsed: Record<string, unknown>, content: string, relatedItems?: RelatedItem[]): Classification;
}

export const IClassificationService = createServiceIdentifier<IClassificationService>("classificationService");

const VALID_INTENTS: ClassificationIntent[] = ["note", "bookmark", "todo", "mixed", "clarify"];

export class ClassificationService implements IClassificationService {
  constructor(private readonly config: AppConfig) {}

  rulePreview(content: string, url: string): Classification {
    const text = (content || "").trim();
    const urls = extractUrls(text);
    if (url && !urls.includes(url)) urls.unshift(url);
    const knowledgeCaptureCommand = looksLikeKnowledgeCaptureCommand(text);
    const tasks = knowledgeCaptureCommand ? [] : ruleTasks(text);
    let intent: ClassificationIntent;
    if (knowledgeCaptureCommand) {
      intent = "note";
    }
    else if (urls.length && text.length <= 600 && !looksLikeProse(text)) {
      intent = urls.some(looksLikeDocumentUrl) ? "note" : "bookmark";
    }
    else if (tasks.length >= 1 && text.length <= 400) intent = "todo";
    else if (text.length > 280 || looksLikeProse(text)) intent = "note";
    else if (urls.length) intent = "bookmark";
    else intent = "note";
    const firstLine = firstNonemptyLine(text);
    const title =
      (urls.length === 1 && firstLine === urls[0] ? titleFromUrl(urls[0]) : firstLine).slice(0, 80) ||
      titleFromUrl(urls[0] || "") ||
      "Capture";
    const multiUrlItems = urls.length > 1 ? urls.map((entry) => mixedItemFromUrl(entry)) : [];
    const multiUrlIntent: ClassificationIntent =
      multiUrlItems.length && multiUrlItems.some((item) => item.type === "bookmark") ? "mixed" : intent;
    return {
      primaryIntent: multiUrlIntent,
      confidence: 0,
      alternatives: [],
      title: multiUrlItems.length ? titleFromUrls(urls) : title,
      summary: text.slice(0, 200),
      tags: multiUrlItems.length ? ["bookmarks"] : [],
      extractedUrls: urls,
      extractedTasks: tasks,
      items: multiUrlItems,
      todoUpgrade: { agentCompletable: false, suggestedIssueTitle: "" },
      source: "rule",
    };
  }

  async agentPrompt(content: string): Promise<string> {
    const template = await readFile(resolve(this.config.promptsDir, "agent.md"), "utf-8");
    return template.replace("{{CONTENT}}", (content || "").trim());
  }

  normalizeAgentResult(parsed: Record<string, unknown>, _content: string): AgentTaskResult {
    const rawPurpose = String(parsed.purpose || "").trim().toLowerCase();
    if (rawPurpose !== "create" && rawPurpose !== "organize" && rawPurpose !== "query") {
      throw new Error("agent result has an invalid purpose");
    }
    const purpose = rawPurpose;
    const intents = Array.isArray(parsed.intents)
      ? [...new Set(parsed.intents.map((value) => String(value || "").trim().toLowerCase()))]
          .filter((value): value is "note" | "bookmark" | "todo" =>
            value === "note" || value === "bookmark" || value === "todo",
          )
      : [];
    if (!intents.length) throw new Error("agent result has no content intents");
    const rawChangedFiles = Array.isArray(parsed.changedFiles)
      ? parsed.changedFiles.map((value) => String(value || "").trim().replace(/\\/g, "/"))
      : [];
    if (rawChangedFiles.some((value) => !isSafeLibraryMarkdownPath(value))) {
      throw new Error("agent result contains an unsafe changed file path");
    }
    if (purpose === "query" && rawChangedFiles.length) {
      throw new Error("query result must not report changed files");
    }
    const changedFiles = rawChangedFiles.filter((value, index, values) => values.indexOf(value) === index);
    const answer = String(parsed.answer || "").trim();
    if (purpose === "query" && !answer) throw new Error("query result has no answer");
    return {
      purpose,
      intents,
      summary: String(parsed.summary || "").trim() || "Agent completed the request.",
      answer: purpose === "query" ? answer : "",
      changedFiles,
    };
  }

  parseStrictJson(text: string): unknown {
    let candidate = text.trim();
    const fence = candidate.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (fence) {
      candidate = fence[1]!;
    } else {
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        candidate = candidate.slice(start, end + 1);
      }
    }
    return JSON.parse(candidate);
  }

  normalize(parsed: Record<string, unknown>, content: string, relatedItems: RelatedItem[] = []): Classification {
    let intent = String(parsed.primaryIntent || "note").trim().toLowerCase() as ClassificationIntent;
    if (!VALID_INTENTS.includes(intent)) intent = "note";
    const urls = Array.isArray(parsed.extractedUrls)
      ? (parsed.extractedUrls as unknown[]).map(String)
      : extractUrls(content);
    const tasks = Array.isArray(parsed.extractedTasks) ? (parsed.extractedTasks as unknown[]).map(String) : [];
    const tags = Array.isArray(parsed.tags) ? (parsed.tags as unknown[]).map(String) : [];
    const alternatives = normalizeAlternatives(parsed.alternatives);
    const items = normalizeMixedItems(parsed.items, relatedItems);
    const mergePreview = normalizeMergePreview(parsed.mergePreview, relatedItems);
    const savePlan = normalizeSavePlan(parsed.savePlan, relatedItems, mergePreview);
    const effectiveMergePreview = savePlan ? syncMergePreviewFromSavePlan(savePlan) : mergePreview;
    const upgrade = (parsed.todoUpgrade as Record<string, unknown>) || {};
    return {
      primaryIntent: intent,
      confidence: clampConfidence(parsed.confidence),
      alternatives,
      title: String(parsed.title || firstNonemptyLine(content) || "Capture").slice(0, 120),
      summary: String(parsed.summary || "").trim(),
      tags: tags.map((t) => t.trim()).filter(Boolean).slice(0, 5),
      extractedUrls: urls.map((u) => u.trim()).filter(Boolean),
      extractedTasks: tasks.map((t) => t.trim()).filter(Boolean),
      items,
      relatedItems,
      savePlan,
      mergePreview: effectiveMergePreview,
      todoUpgrade: {
        agentCompletable: Boolean(upgrade.agentCompletable),
        suggestedIssueTitle: String(upgrade.suggestedIssueTitle || "").trim(),
      },
      source: String(parsed.source || "agent"),
    };
  }
}

function isSafeLibraryMarkdownPath(value: string): boolean {
  return /^(notes|bookmarks|todos)\/[^/].*\.md$/i.test(value) &&
    !value.split("/").includes("..") &&
    !value.includes("\0");
}

function normalizeAlternatives(value: unknown): Classification["alternatives"] {
  if (!Array.isArray(value)) return [];
  const alternatives: Classification["alternatives"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const intent = String(raw.intent || "").trim().toLowerCase();
    if (intent !== "note" && intent !== "bookmark" && intent !== "todo" && intent !== "mixed") continue;
    alternatives.push({ intent, reason: String(raw.reason || "").trim() });
  }
  return alternatives.filter((item) => item.reason).slice(0, 4);
}

function normalizeMixedItems(value: unknown, relatedItems: RelatedItem[] = []): MixedItem[] {
  if (!Array.isArray(value)) return [];
  const items: MixedItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const type = String(raw.type || "").trim().toLowerCase();
    if (type !== "note" && type !== "bookmark" && type !== "todo") continue;
    const tasks = Array.isArray(raw.tasks)
      ? raw.tasks.map((task) => String(task || "").trim()).filter(Boolean).slice(0, 12)
      : undefined;
    const tags = Array.isArray(raw.tags)
      ? raw.tags.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 5)
      : undefined;
    const mergePreview = normalizeMergePreview(raw.mergePreview, relatedItems);
    const savePlan = normalizeSavePlan(raw.savePlan, relatedItems, mergePreview);
    items.push({
      type,
      title: String(raw.title || "").trim() || undefined,
      summary: String(raw.summary || "").trim() || undefined,
      url: String(raw.url || "").trim() || undefined,
      tags,
      tasks,
      savePlan,
    });
  }
  return items.slice(0, 12);
}

function clampConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeMergePreview(value: unknown, relatedItems: RelatedItem[]): Classification["mergePreview"] {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const rawTargetItemId = String(raw.targetItemId || "").trim();
  const existingContent = String(raw.existingContent || "").trim();
  const insertedContent = String(raw.insertedContent || "").trim();
  if (!existingContent && !insertedContent) return null;
  const target = relatedItems.find((item) => item.id === rawTargetItemId && item.type === "note");
  return {
    targetItemId: target?.id || undefined,
    targetTitle: String(raw.targetTitle || target?.title || "").trim(),
    existingContent,
    insertedContent,
  };
}

export function ruleTasks(text: string): string[] {
  const tasks: string[] = [];
  for (const line of (text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cleaned = trimmed
      .replace(/^[-*]\s+\[\s?\]\s+/, "")
      .replace(/^\[\s?\]\s+/, "")
      .replace(/^([-*]|\d+[.)])\s+/, "");
    const prefixed = trimmed.match(/^(?:todo|to do|task|待办|任务)[:：]\s*(.+)$/i)?.[1]?.trim();
    const imperative = /^(?:remember to|remind me to|need to|要|需要|记得|提醒我|帮我)\s*(.+)$/i.exec(trimmed)?.[1]?.trim();
    const task = cleaned !== trimmed ? cleaned : prefixed || imperative || "";
    if (task && !tasks.includes(task)) tasks.push(task);
  }
  return tasks;
}

function titleFromUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/$/, "").split("/").filter(Boolean).at(-1) || "";
    return [host, path ? decodeURIComponent(path).replace(/[-_]+/g, " ") : ""].filter(Boolean).join(" - ");
  } catch {
    return url;
  }
}

function titleFromUrls(urls: string[]): string {
  if (urls.length <= 1) return titleFromUrl(urls[0] || "") || "Bookmarks";
  return `Captured links (${urls.length})`;
}

function mixedItemFromUrl(url: string): MixedItem {
  const title = titleFromUrl(url) || url;
  const type: MixedItem["type"] = looksLikeDocumentUrl(url) ? "note" : "bookmark";
  return {
    type,
    title,
    summary: url,
    url,
    tags: tagsFromUrl(url, type),
    tasks: [],
  };
}

function tagsFromUrl(url: string, type: MixedItem["type"]): string[] {
  const tags: string[] = [];
  if (type === "note") tags.push("article");
  try {
    const parsed = new URL(url);
    const hostParts = parsed.hostname.replace(/^www\./, "").split(".");
    const domain = hostParts.length > 1 ? hostParts.at(-2) || "" : hostParts[0] || "";
    if (domain && !tags.includes(domain)) tags.push(domain);
  } catch {
    /* keep generic tags */
  }
  if (!tags.length) tags.push(type === "bookmark" ? "tool" : "note");
  return tags.slice(0, 5);
}

function looksLikeProse(text: string): boolean {
  return text.split(/\s+/).length > 40 || (text.match(/\n/g)?.length || 0) > 4;
}

function looksLikeKnowledgeCaptureCommand(text: string): boolean {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return false;
  const commandLike =
    /^(?:帮我|请|麻烦|把|将|新建|创建|整理|汇总|总结|记录|保存|归档|help me|please|create|save|capture|organize|summari[sz]e|merge)/i.test(
      compact,
    ) || /(?:直接帮我|帮我.*(?:创建|新建|整理|汇总|总结|保存|记录))/i.test(compact);
  if (!commandLike) return false;
  return /(?:笔记|文档|论文|文章|资料|知识库|阅读|读书|汇总|总结|note|notes|document|paper|papers|article|reading|knowledge)/i.test(
    compact,
  );
}

function looksLikeDocumentUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /arxiv\.org|doi\.org|pubmed|scholar|paper|papers|publication|article|blog|posts?|essay|research|\.pdf(?:$|[?#/])/.test(lower);
}
