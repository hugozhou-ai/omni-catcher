import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import type { ILogService } from "@omni-catcher/shared/platform";
import type { Classification, ClassificationIntent, MixedItem, RelatedItem } from "@omni-catcher/shared";
import type { AppConfig } from "../config.js";
import { extractUrls, firstNonemptyLine } from "../util.js";
import type { ITuttiCliService } from "./tuttiCliService.js";

export interface IClassificationService {
  rulePreview(content: string, url: string): Classification;
  classifyPrompt(content: string, relatedItems?: RelatedItem[]): Promise<string>;
  parseStrictJson(text: string): unknown;
  normalize(parsed: Record<string, unknown>, content: string, relatedItems?: RelatedItem[]): Classification;
}

export const IClassificationService = createServiceIdentifier<IClassificationService>("classificationService");

const VALID_INTENTS: ClassificationIntent[] = ["note", "bookmark", "todo", "mixed", "clarify"];
const URL_CONTEXT_LOG_PREFIX = "url-context";

export class ClassificationService implements IClassificationService {
  constructor(
    private readonly config: AppConfig,
    private readonly cli: ITuttiCliService,
    private readonly log: ILogService,
  ) {}

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

  async classifyPrompt(content: string, relatedItems: RelatedItem[] = []): Promise<string> {
    const template = await readFile(resolve(this.config.promptsDir, "classify.md"), "utf-8");
    const enriched = await enrichContentForClassification(content, this.cli, this.log);
    return template
      .replace("{{EXISTING_ITEMS}}", formatRelatedItemsForPrompt(relatedItems))
      .replace("{{CONTENT}}", enriched);
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
    const alternatives = Array.isArray(parsed.alternatives)
      ? (parsed.alternatives as Classification["alternatives"])
      : [];
    const items = Array.isArray(parsed.items) ? (parsed.items as MixedItem[]) : [];
    const mergePreview = normalizeMergePreview(parsed.mergePreview, relatedItems);
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
      relatedItems,
      mergePreview,
      todoUpgrade: {
        agentCompletable: Boolean(upgrade.agentCompletable),
        suggestedIssueTitle: String(upgrade.suggestedIssueTitle || "").trim(),
      },
      source: String(parsed.source || "agent"),
    };
  }
}

function normalizeMergePreview(value: unknown, relatedItems: RelatedItem[]): Classification["mergePreview"] {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const rawTargetItemId = String(raw.targetItemId || "").trim();
  const existingContent = String(raw.existingContent || "").trim();
  const insertedContent = String(raw.insertedContent || "").trim();
  if (!existingContent && !insertedContent) return null;
  const target = relatedItems.find((item) => item.id === rawTargetItemId);
  return {
    targetItemId: target?.id || undefined,
    targetTitle: String(raw.targetTitle || target?.title || "").trim(),
    existingContent,
    insertedContent,
  };
}

function formatRelatedItemsForPrompt(relatedItems: RelatedItem[]): string {
  if (!relatedItems.length) return "No related saved items were found.";
  return relatedItems
    .map((item, index) =>
      [
        `Related item ${index + 1}:`,
        `- id: ${item.id}`,
        `- type: ${item.type}`,
        `- title: ${item.title}`,
        item.summary ? `- summary: ${item.summary}` : "",
        item.tags.length ? `- tags: ${item.tags.join(", ")}` : "",
        `- path: ${item.path}`,
        `- match: ${item.reason} (${item.score})`,
        item.excerpt ? `- excerpt: ${item.excerpt}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

const MAX_URL_CONTEXTS = 2;
const MAX_FETCHED_TEXT_CHARS = 300_000;
const MAX_EXCERPT_CHARS = 2_500;
const MAX_ENRICHED_CONTENT_CHARS = 7_000;

type UrlContext = {
  source: "fetch" | "browser" | "url";
  text: string;
};

async function enrichContentForClassification(
  content: string,
  cli: ITuttiCliService,
  log: ILogService,
): Promise<string> {
  const text = (content || "").trim();
  const urls = extractUrls(text).slice(0, MAX_URL_CONTEXTS);
  if (!urls.length) return text;
  const contexts = (await Promise.all(urls.map((url) => readUrlContext(url, cli, log)))).filter(Boolean);
  if (!contexts.length) return text;
  for (const context of contexts) {
    log.info(
      `${URL_CONTEXT_LOG_PREFIX} ${JSON.stringify({
        event: "selected",
        source: context.source,
        length: context.text.length,
      })}`,
    );
  }
  const enriched = [
    text,
    "",
    "URL context for intent classification. Prefer fetched/browser page content; use URL signal only when page content is unavailable:",
    contexts.map((context) => context.text).join("\n\n"),
  ].join("\n");
  return enriched.slice(0, MAX_ENRICHED_CONTENT_CHARS);
}

async function readUrlContext(url: string, cli: ITuttiCliService, log: ILogService): Promise<UrlContext> {
  const fetched = await fetchUrlContext(url, log);
  if (hasUsablePageText(fetched.pageText)) return { source: "fetch", text: fetched.context };
  const browser = await browserUrlContext(url, cli, log);
  if (browser && hasUsablePageText(browser.pageText)) return { source: "browser", text: browser.context };
  return { source: "url", text: urlContextFromUrlOnly(url, fetched.contentType) };
}

async function fetchUrlContext(
  url: string,
  log: ILogService,
): Promise<{ context: string; pageText: string; contentType: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        "user-agent": "OmniCatcher/0.1 (+https://tutti.local)",
        accept: "text/html, text/plain;q=0.9, */*;q=0.5",
      },
    });
  } catch (error) {
    log.info(
      `${URL_CONTEXT_LOG_PREFIX} ${JSON.stringify({
        event: "fetch_failed",
        url,
        error: (error as Error).message,
      })}`,
    );
    return { context: urlContextFromUrlOnly(url), pageText: "", contentType: "" };
  }
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) return { context: urlContextFromUrlOnly(url, contentType), pageText: "", contentType };
  if (!/^text\/html|^text\/plain/i.test(contentType)) {
    return { context: urlContextFromUrlOnly(url, contentType), pageText: "", contentType };
  }
  let html = "";
  try {
    html = (await response.text()).slice(0, MAX_FETCHED_TEXT_CHARS);
  } catch (error) {
    log.info(
      `${URL_CONTEXT_LOG_PREFIX} ${JSON.stringify({
        event: "fetch_read_failed",
        url,
        error: (error as Error).message,
      })}`,
    );
    return { context: urlContextFromUrlOnly(url, contentType), pageText: "", contentType };
  }
  const title = extractTagText(html, "title");
  const description =
    extractMeta(html, "description") ||
    extractMeta(html, "og:description") ||
    extractMeta(html, "twitter:description");
  const h1 = extractTagText(html, "h1");
  const pageText = htmlToText(html);
  const excerpt = pageText.slice(0, MAX_EXCERPT_CHARS);
  const context = compactLines([
    `URL: ${url}`,
    `Content-Type: ${contentType}`,
    "Page read source: fetch",
    `URL signal: ${looksLikeDocumentUrl(url) ? "article-or-paper-like" : "site-or-tool-like"}`,
    title ? `Title: ${title}` : "",
    h1 && h1 !== title ? `Heading: ${h1}` : "",
    description ? `Description: ${description}` : "",
    excerpt ? `Text excerpt: ${excerpt}` : "",
  ]).join("\n");
  return { context, pageText, contentType };
}

async function browserUrlContext(
  url: string,
  cli: ITuttiCliService,
  log: ILogService,
): Promise<{ context: string; pageText: string } | null> {
  if (!cli.isConfigured()) return null;
  try {
    await cli.run(["browser", "navigate", "--url", url], 20_000);
    const result = await cli.run(
      [
        "browser",
        "eval",
        "--script",
        "() => ({ title: document.title, url: location.href, text: document.body ? document.body.innerText : '' })",
      ],
      20_000,
    );
    const payload = extractBrowserPayload(result);
    const pageText = payload.text.trim();
    if (!hasUsablePageText(pageText)) {
      const snapshot = await cli.run(["browser", "snapshot"], 20_000).catch(() => ({}));
      const snapshotText = extractLongestString(snapshot).trim();
      const contextText = snapshotText || pageText;
      if (!hasUsablePageText(contextText)) return null;
      return {
        context: browserContextText(url, payload.title, contextText),
        pageText: contextText,
      };
    }
    return {
      context: browserContextText(url, payload.title, pageText),
      pageText,
    };
  } catch (error) {
    log.info(
      `${URL_CONTEXT_LOG_PREFIX} ${JSON.stringify({
        event: "browser_failed",
        url,
        error: (error as Error).message,
      })}`,
    );
    return null;
  }
}

function browserContextText(url: string, title: string, pageText: string): string {
  return compactLines([
    `URL: ${url}`,
    "Page read source: browser",
    `URL signal: ${looksLikeDocumentUrl(url) ? "article-or-paper-like" : "site-or-tool-like"}`,
    title ? `Title: ${title}` : "",
    `Text excerpt: ${pageText.slice(0, MAX_EXCERPT_CHARS)}`,
  ]).join("\n");
}

function hasUsablePageText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length < 120) return false;
  return !/^(please wait|loading|加载中|请稍候|just a moment|enable javascript)[.!。…\s]*$/i.test(normalized.slice(0, 80));
}

function extractBrowserPayload(value: unknown): { title: string; text: string } {
  const raw = unwrapCliValue(value);
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return {
      title: String(obj.title || ""),
      text: String(obj.text || obj.innerText || obj.result || ""),
    };
  }
  return { title: "", text: String(raw || "") };
}

function unwrapCliValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  for (const key of ["result", "value", "data", "page", "snapshot"]) {
    if (key in obj) return unwrapCliValue(obj[key]);
  }
  return obj;
}

function extractLongestString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(extractLongestString).sort((a, b) => b.length - a.length)[0] || "";
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map(extractLongestString)
      .sort((a, b) => b.length - a.length)[0] || "";
  }
  return "";
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
