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
    if (urls.length && text.length <= 600 && !looksLikeProse(text)) {
      intent = urls.some(looksLikeDocumentUrl) ? "note" : "bookmark";
    }
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
    const enriched = await enrichContentForClassification(content);
    return template.replace("{{CONTENT}}", enriched);
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

async function enrichContentForClassification(content: string): Promise<string> {
  const text = (content || "").trim();
  const urls = extractUrls(text).slice(0, 3);
  if (!urls.length) return text;
  const contexts = (await Promise.all(urls.map(fetchUrlContext))).filter(Boolean);
  if (!contexts.length) return text;
  return [
    text,
    "",
    "URL context for intent classification:",
    contexts.join("\n\n"),
  ].join("\n");
}

async function fetchUrlContext(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        "user-agent": "OmniCatcher/0.1 (+https://tutti.local)",
        accept: "text/html, text/plain;q=0.9, */*;q=0.5",
      },
    });
  } catch {
    return urlContextFromUrlOnly(url);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) return urlContextFromUrlOnly(url, contentType);
  if (!/^text\/html|^text\/plain/i.test(contentType)) {
    return urlContextFromUrlOnly(url, contentType);
  }
  let html = "";
  try {
    html = (await response.text()).slice(0, 300_000);
  } catch {
    return urlContextFromUrlOnly(url, contentType);
  }
  const title = extractTagText(html, "title");
  const description =
    extractMeta(html, "description") ||
    extractMeta(html, "og:description") ||
    extractMeta(html, "twitter:description");
  const h1 = extractTagText(html, "h1");
  const excerpt = htmlToText(html).slice(0, 1800);
  return compactLines([
    `URL: ${url}`,
    `Content-Type: ${contentType}`,
    title ? `Title: ${title}` : "",
    h1 && h1 !== title ? `Heading: ${h1}` : "",
    description ? `Description: ${description}` : "",
    excerpt ? `Text excerpt: ${excerpt}` : "",
  ]).join("\n");
}

function urlContextFromUrlOnly(url: string, contentType = ""): string {
  return compactLines([
    `URL: ${url}`,
    contentType ? `Content-Type: ${contentType}` : "",
    `URL signal: ${looksLikeDocumentUrl(url) ? "article-or-paper-like" : "site-or-tool-like"}`,
  ]).join("\n");
}

function extractMeta(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<meta\\s+[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    "i",
  );
  const reversePattern = new RegExp(
    `<meta\\s+[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${escaped}["'][^>]*>`,
    "i",
  );
  const match = html.match(pattern) || html.match(reversePattern);
  return decodeHtml(match?.[1] || "").trim();
}

function extractTagText(html: string, tag: string): string {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeHtml(stripTags(match?.[1] || "")).trim();
}

function htmlToText(html: string): string {
  return decodeHtml(
    stripTags(
      html
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<\/(p|div|article|section|h[1-6]|li)>/gi, "\n"),
    ),
  )
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function compactLines(lines: string[]): string[] {
  return lines.map((line) => line.trim()).filter(Boolean);
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

function looksLikeDocumentUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /arxiv\.org|doi\.org|pubmed|scholar|paper|papers|publication|article|blog|posts?|essay|research|\.pdf(?:$|[?#/])/.test(lower);
}
