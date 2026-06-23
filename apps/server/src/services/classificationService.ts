import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import type { Classification, ClassificationIntent, MixedItem } from "@omni-catcher/shared";
import type { AppConfig } from "../config.js";
import { extractUrls, firstNonemptyLine } from "../util.js";

export interface IClassificationService {
  rulePreview(content: string, url: string): Classification;
  classifyPrompt(content: string): Promise<string>;
  parseStrictJson(text: string): unknown;
  normalize(parsed: Record<string, unknown>, content: string): Classification;
}

export const IClassificationService = createServiceIdentifier<IClassificationService>("classificationService");

const VALID_INTENTS: ClassificationIntent[] = ["note", "bookmark", "todo", "mixed", "clarify"];

export class ClassificationService implements IClassificationService {
  constructor(private readonly config: AppConfig) {}

  rulePreview(content: string, url: string): Classification {
    const text = (content || "").trim();
    const urls = extractUrls(text);
    if (url && !urls.includes(url)) urls.unshift(url);
    const tasks = ruleTasks(text);
    let intent: ClassificationIntent;
    if (urls.length && text.length <= 600 && !looksLikeProse(text)) intent = "bookmark";
    else if (tasks.length >= 1 && text.length <= 400) intent = "todo";
    else if (text.length > 280 || looksLikeProse(text)) intent = "note";
    else if (urls.length) intent = "bookmark";
    else intent = "note";
    const title = firstNonemptyLine(text).slice(0, 80) || urls[0] || "Capture";
    return {
      primaryIntent: intent,
      confidence: 0,
      alternatives: [],
      title,
      summary: text.slice(0, 200),
      tags: [],
      extractedUrls: urls,
      extractedTasks: tasks,
      items: [],
      todoUpgrade: { agentCompletable: false, suggestedIssueTitle: "" },
      source: "rule",
    };
  }

  async classifyPrompt(content: string): Promise<string> {
    const template = await readFile(resolve(this.config.promptsDir, "classify.md"), "utf-8");
    return template.replace("{{CONTENT}}", content);
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

  normalize(parsed: Record<string, unknown>, content: string): Classification {
    let intent = String(parsed.primaryIntent || "note").trim().toLowerCase() as ClassificationIntent;
    if (!VALID_INTENTS.includes(intent)) intent = "note";
    const urls = Array.isArray(parsed.extractedUrls)
      ? (parsed.extractedUrls as unknown[]).map(String)
      : extractUrls(content);
    const tasks = Array.isArray(parsed.extractedTasks) ? (parsed.extractedTasks as unknown[]).map(String) : [];
    const tags = Array.isArray(parsed.tags) ? (parsed.tags as unknown[]).map(String) : [];
    const alternatives = Array.isArray(parsed.alternatives)
      ? (parsed.alternatives as Classification["alternatives"])
      : [];
    const items = Array.isArray(parsed.items) ? (parsed.items as MixedItem[]) : [];
    const mergePreview = normalizeMergePreview(parsed.mergePreview);
    const upgrade = (parsed.todoUpgrade as Record<string, unknown>) || {};
    return {
      primaryIntent: intent,
      confidence: Number(parsed.confidence) || 0,
      alternatives,
      title: String(parsed.title || firstNonemptyLine(content) || "Capture").slice(0, 120),
      summary: String(parsed.summary || "").trim(),
      tags: tags.map((t) => t.trim()).filter(Boolean).slice(0, 5),
      extractedUrls: urls.map((u) => u.trim()).filter(Boolean),
      extractedTasks: tasks.map((t) => t.trim()).filter(Boolean),
      items,
      mergePreview,
      todoUpgrade: {
        agentCompletable: Boolean(upgrade.agentCompletable),
        suggestedIssueTitle: String(upgrade.suggestedIssueTitle || "").trim(),
      },
      source: String(parsed.source || "agent"),
    };
  }
}

function normalizeMergePreview(value: unknown): Classification["mergePreview"] {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const existingContent = String(raw.existingContent || "").trim();
  const insertedContent = String(raw.insertedContent || "").trim();
  if (!existingContent && !insertedContent) return null;
  return {
    targetTitle: String(raw.targetTitle || "").trim(),
    existingContent,
    insertedContent,
  };
}

export function ruleTasks(text: string): string[] {
  const tasks: string[] = [];
  for (const line of (text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cleaned = trimmed.replace(/^([-*]|\d+[.)]|\[\s?\])\s+/, "");
    if (cleaned !== trimmed) tasks.push(cleaned);
  }
  return tasks;
}

function looksLikeProse(text: string): boolean {
  return text.split(/\s+/).length > 40 || (text.match(/\n/g)?.length || 0) > 4;
}
