import { mkdir, readFile, readdir, writeFile, appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { URL } from "node:url";
import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import type {
  Capture,
  Classification,
  ConfirmEdits,
  Intent,
  Item,
  ItemContentUpdate,
  ItemMetaUpdate,
  PriorityLevel,
  RelatedItem,
  TodoProgress,
} from "@omni-catcher/shared";
import type { AppConfig } from "../config.js";
import { migrateDataDirIfNeeded } from "../dataMigration.js";
import { Mutex, extractUrls, nowIso, slugify, todayStamp } from "../util.js";
import { insertAtHeading } from "../savePlanUtil.js";
import { ruleTasks } from "./classificationService.js";

export const INTENT_DIRS: Record<Intent, string> = {
  note: "notes",
  bookmark: "bookmarks",
  todo: "todos",
  mixed: "notes",
};

export interface IStorageService {
  init(): Promise<void>;
  readSettings(): Promise<Record<string, unknown>>;
  writeSettings(settings: Record<string, unknown>): Promise<Record<string, unknown>>;
  readCapture(id: string): Promise<Capture | null>;
  writeCapture(capture: Capture): Promise<Capture>;
  listCaptures(): Promise<Capture[]>;
  deleteCapture(id: string): Promise<void>;
  listItems(type?: string): Promise<Item[]>;
  findItem(id: string): Promise<Item | null>;
  readItem(id: string): Promise<{ item: Item; markdown: string } | null>;
  searchItems(query: string): Promise<Item[]>;
  findRelatedItems(content: string, limit?: number): Promise<RelatedItem[]>;
  updateItemMeta(id: string, update: ItemMetaUpdate): Promise<Item>;
  updateItemContent(id: string, update: ItemContentUpdate): Promise<{ item: Item; markdown: string }>;
  updateTodoTask(id: string, taskIndex: number, completed: boolean): Promise<{ item: Item; markdown: string }>;
  mergeIntoItem(id: string, classification: Classification, content: string, capture: Capture, edits: ConfirmEdits): Promise<Item>;
  deleteItem(id: string): Promise<Item>;
  writeItem(
    intent: Intent,
    classification: Classification,
    content: string,
    capture: Capture,
    edits: ConfirmEdits,
    suffix?: string,
  ): Promise<Item>;
  rebuildIndex(): Promise<Item[]>;
  dataDir: string;
}

export const IStorageService = createServiceIdentifier<IStorageService>("storageService");

export class StorageService implements IStorageService {
  private readonly mutex = new Mutex();
  private readonly config: AppConfig;
  readonly dataDir: string;
  private readonly inboxDir: string;
  private readonly indexPath: string;
  private readonly settingsPath: string;

  constructor(config: AppConfig) {
    this.config = config;
    this.dataDir = config.dataDir;
    this.inboxDir = join(this.dataDir, "inbox");
    this.indexPath = join(this.dataDir, "index.jsonl");
    this.settingsPath = join(this.dataDir, "settings.json");
  }

  async init(): Promise<void> {
    migrateDataDirIfNeeded({
      appId: this.config.appId,
      workspaceId: this.config.workspaceId,
      dataDir: this.dataDir,
    });
    await mkdir(this.inboxDir, { recursive: true });
    for (const folder of new Set(Object.values(INTENT_DIRS))) {
      await mkdir(join(this.dataDir, folder), { recursive: true });
    }
  }

  // -- settings ------------------------------------------------------------

  async readSettings(): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await readFile(this.settingsPath, "utf-8"));
    } catch {
      return {};
    }
  }

  async writeSettings(settings: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.mutex.run(() => writeFile(this.settingsPath, JSON.stringify(settings, null, 2), "utf-8"));
    return settings;
  }

  // -- captures ------------------------------------------------------------

  private capturePath(id: string): string {
    return join(this.inboxDir, `${id}.json`);
  }

  async readCapture(id: string): Promise<Capture | null> {
    try {
      return normalizeStoredCapture(JSON.parse(await readFile(this.capturePath(id), "utf-8")));
    } catch {
      return null;
    }
  }

  async writeCapture(capture: Capture): Promise<Capture> {
    const persisted = { ...capture };
    delete persisted.activityText;
    await this.mutex.run(() =>
      writeFile(this.capturePath(capture.id), JSON.stringify(persisted, null, 2), "utf-8"),
    );
    return persisted;
  }

  async listCaptures(): Promise<Capture[]> {
    let names: string[] = [];
    try {
      names = (await readdir(this.inboxDir)).filter((name) => name.endsWith(".json"));
    } catch {
      return [];
    }
    const captures: Capture[] = [];
    for (const name of names) {
      try {
        captures.push(
          normalizeStoredCapture(JSON.parse(await readFile(join(this.inboxDir, name), "utf-8"))),
        );
      } catch {
        /* skip corrupt */
      }
    }
    captures.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return captures;
  }

  async deleteCapture(id: string): Promise<void> {
    await this.mutex.run(() => rm(this.capturePath(id), { force: true }));
  }

  // -- index + items -------------------------------------------------------

  private async readIndex(): Promise<Item[]> {
    let text: string;
    try {
      text = await readFile(this.indexPath, "utf-8");
    } catch {
      return [];
    }
    const items: Item[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        items.push(JSON.parse(trimmed) as Item);
      } catch {
        /* skip */
      }
    }
    return items;
  }

  async listItems(type?: string): Promise<Item[]> {
    const filter = (type || "").trim().toLowerCase();
    const items = await this.readIndex();
    return filter ? items.filter((item) => item.type === filter) : items;
  }

  async findItem(id: string): Promise<Item | null> {
    return (await this.readIndex()).find((item) => item.id === id) || null;
  }

  async readItem(id: string): Promise<{ item: Item; markdown: string } | null> {
    const item = await this.findItem(id);
    if (!item) return null;
    try {
      const markdown = await readFile(join(this.dataDir, item.path), "utf-8");
      return { item, markdown };
    } catch {
      return null;
    }
  }

  async searchItems(query: string): Promise<Item[]> {
    const needle = query.toLowerCase();
    const results: Item[] = [];
    for (const item of await this.readIndex()) {
      const blob = [item.title, item.summary || "", item.type, (item.tags || []).join(" ")].join(" ").toLowerCase();
      if (blob.includes(needle)) {
        results.push(item);
        continue;
      }
      try {
        const text = (await readFile(join(this.dataDir, item.path), "utf-8")).toLowerCase();
        if (text.includes(needle)) results.push(item);
      } catch {
        /* skip */
      }
    }
    return results;
  }

  async findRelatedItems(content: string, limit = 6): Promise<RelatedItem[]> {
    const text = content.trim();
    if (!text) return [];
    const urls = extractUrls(text).map(normalizeUrlForCompare);
    const dois = extractDois(text);
    const arxivIds = extractArxivIds(text);
    const terms = significantTerms(text);
    const contentTags = extractHashTags(text);
    const items = await this.readIndex();
    const related: RelatedItem[] = [];
    for (const item of items) {
      if (item.type !== "note" && item.type !== "bookmark") continue;
      let markdown = "";
      try {
        markdown = await readFile(join(this.dataDir, item.path), "utf-8");
      } catch {
        /* keep metadata-only comparison */
      }
      const bodyStart = markdown.indexOf("\n---\n", 4);
      const body = bodyStart >= 0 ? markdown.slice(bodyStart + 5) : markdown;
      const haystack = [item.title, item.summary || "", item.type, (item.tags || []).join(" "), markdown]
        .join("\n")
        .toLowerCase();
      const itemUrls = extractUrls(markdown).map(normalizeUrlForCompare);
      const itemDois = extractDois(markdown);
      const itemArxiv = extractArxivIds(markdown);
      const exactUrl = urls.length > 0 && urls.some((url) => itemUrls.includes(url));
      const exactDoi = dois.length > 0 && dois.some((doi) => itemDois.includes(doi));
      const exactArxiv = arxivIds.length > 0 && arxivIds.some((id) => itemArxiv.includes(id));
      const itemTitle = item.title.toLowerCase();
      const titleInContent = itemTitle.length >= 12 && text.toLowerCase().includes(itemTitle);
      const titleMatch =
        itemTitle.length >= 8 &&
        terms.some((term) => term.length >= 8 && (itemTitle.includes(term) || term.includes(itemTitle.slice(0, 20))));
      const tagHits = (item.tags || []).filter((tag) =>
        contentTags.includes(tag.toLowerCase()) || terms.includes(tag.toLowerCase()),
      );
      const termHits = terms.filter((term) => haystack.includes(term));
      const isCollection = looksLikeCollectionNote(item.title, item.tags || [], body);
      let score =
        (exactUrl ? 100 : 0) +
        (exactDoi ? 95 : 0) +
        (exactArxiv ? 95 : 0) +
        (titleInContent ? 40 : 0) +
        (titleMatch ? 28 : 0) +
        tagHits.length * 12 +
        termHits.length * 8 +
        (isCollection ? 10 : 0);
      if (score < 16) continue;
      const reason = exactUrl
        ? "same-url"
        : exactDoi
          ? "same-doi"
          : exactArxiv
            ? "same-arxiv"
            : titleInContent || titleMatch
              ? "same-title"
              : tagHits.length
                ? "tag-match"
                : isCollection
                  ? "collection-candidate"
                  : "shared-terms";
      related.push({
        id: item.id,
        type: item.type,
        title: item.title,
        summary: item.summary,
        path: item.path,
        tags: item.tags || [],
        score,
        reason,
        excerpt: excerptMarkdown(markdown),
        insertHeadings: extractMarkdownHeadings(body).slice(0, 12),
        isCollection,
      });
    }
    return related.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async updateItemMeta(id: string, update: ItemMetaUpdate): Promise<Item> {
    const existing = await this.findItem(id);
    if (!existing) throw new Error(`item ${id} was not found`);
    const filePath = join(this.dataDir, existing.path);
    const markdown = await readFile(filePath, "utf-8");
    const meta = parseFrontmatter(markdown);
    if (update.urgency !== undefined) meta.urgency = update.urgency;
    if (update.importance !== undefined) meta.importance = update.importance;
    if (update.todoProgress !== undefined) meta.todoProgress = update.todoProgress;
    const bodyStart = markdown.indexOf("\n---\n", 4);
    const body = bodyStart >= 0 ? markdown.slice(bodyStart + 5) : markdown;
    const nextMarkdown = buildFrontmatter(meta) + "\n" + body;
    const nextItem: Item = {
      ...existing,
      urgency: parsePriorityLevel(meta.urgency) ?? existing.urgency,
      importance: parsePriorityLevel(meta.importance) ?? existing.importance,
      todoProgress: parseTodoProgress(meta.todoProgress) ?? existing.todoProgress,
    };
    await this.mutex.run(async () => {
      await writeFile(filePath, nextMarkdown, "utf-8");
      const items = await this.readIndex();
      const nextIndex = items.map((item) => (item.id === id ? nextItem : item));
      await writeFile(
        this.indexPath,
        nextIndex.map((item) => JSON.stringify(item)).join("\n") + (nextIndex.length ? "\n" : ""),
        "utf-8",
      );
    });
    return nextItem;
  }

  async updateItemContent(id: string, update: ItemContentUpdate): Promise<{ item: Item; markdown: string }> {
    const existing = await this.findItem(id);
    if (!existing) throw new Error(`item ${id} was not found`);
    if (existing.type !== "note" && existing.type !== "bookmark") {
      throw new Error(`item ${id} content is not editable`);
    }
    const filePath = join(this.dataDir, existing.path);
    const markdown = await readFile(filePath, "utf-8");
    const meta = parseFrontmatter(markdown);
    const body = update.body.replace(/\s+$/u, "") + "\n";
    if (update.title !== undefined) {
      const title = update.title.trim();
      if (title) meta.title = title.slice(0, 120);
    }
    if (update.tags !== undefined) {
      meta.tags = update.tags.map((tag: string) => tag.trim()).filter(Boolean).slice(0, 5);
    }
    const summary = body.replace(/\s+/g, " ").trim().slice(0, 900);
    meta.summary = summary;
    const nextMarkdown = buildFrontmatter(meta) + "\n\n" + body.trimStart();
    const nextItem: Item = {
      ...existing,
      title: String(meta.title || existing.title),
      summary: summary || undefined,
      tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : existing.tags,
    };
    await this.mutex.run(async () => {
      await writeFile(filePath, nextMarkdown, "utf-8");
      const items = await this.readIndex();
      const nextIndex = items.map((item) => (item.id === id ? nextItem : item));
      await writeFile(
        this.indexPath,
        nextIndex.map((item) => JSON.stringify(item)).join("\n") + (nextIndex.length ? "\n" : ""),
        "utf-8",
      );
    });
    return { item: nextItem, markdown: nextMarkdown };
  }

  async updateTodoTask(id: string, taskIndex: number, completed: boolean): Promise<{ item: Item; markdown: string }> {
    const existing = await this.findItem(id);
    if (!existing) throw new Error(`item ${id} was not found`);
    if (existing.type !== "todo") throw new Error(`item ${id} is not a todo`);
    const filePath = join(this.dataDir, existing.path);
    const markdown = await readFile(filePath, "utf-8");
    const updatedMarkdown = replaceTodoCheckbox(markdown, taskIndex, completed);
    const meta = parseFrontmatter(updatedMarkdown);
    const todoProgress = inferTodoProgress(updatedMarkdown);
    meta.todoProgress = todoProgress;
    const bodyStart = updatedMarkdown.indexOf("\n---\n", 4);
    const body = bodyStart >= 0 ? updatedMarkdown.slice(bodyStart + 5) : updatedMarkdown;
    const nextMarkdown = buildFrontmatter(meta) + "\n" + body;
    const nextItem: Item = { ...existing, todoProgress };
    await this.mutex.run(async () => {
      await writeFile(filePath, nextMarkdown, "utf-8");
      const items = await this.readIndex();
      const nextIndex = items.map((item) => (item.id === id ? nextItem : item));
      await writeFile(
        this.indexPath,
        nextIndex.map((item) => JSON.stringify(item)).join("\n") + (nextIndex.length ? "\n" : ""),
        "utf-8",
      );
    });
    return { item: nextItem, markdown: nextMarkdown };
  }

  async mergeIntoItem(
    id: string,
    classification: Classification,
    content: string,
    capture: Capture,
    edits: ConfirmEdits,
  ): Promise<Item> {
    const existing = await this.findItem(id);
    if (!existing) throw new Error(`item ${id} was not found`);
    if (existing.type !== "note") throw new Error(`item ${id} is not a note and cannot be merged into`);
    const filePath = join(this.dataDir, existing.path);
    const markdown = await readFile(filePath, "utf-8");
    const meta = parseFrontmatter(markdown);
    const effective = applyEdits(classification, edits);
    const bodyStart = markdown.indexOf("\n---\n", 4);
    const body = bodyStart >= 0 ? markdown.slice(bodyStart + 5).trimEnd() : markdown.trimEnd();
    const bodyPreview = edits.bodyPreview?.trim();
    const incomingBody = bodyPreview || buildBody(existing.type, effective, content, edits).trim();
    const insertHeading = edits.insertHeading?.trim();
    const skipBodyInsert = shouldSkipMergeBody(markdown, content, effective, incomingBody);
    console.info(
      `capture-merge ${JSON.stringify({
        event: skipBodyInsert ? "skip-body" : "insert-body",
        targetItemId: id,
        targetPath: existing.path,
        captureId: capture.id,
        insertHeading: insertHeading || "",
        incomingLength: incomingBody.length,
      })}`,
    );
    const confirmedAt = nowIso();
    const nextMeta: Record<string, unknown> = {
      ...meta,
      tags: mergeStringLists(Array.isArray(meta.tags) ? meta.tags : [], effective.tags),
      urls: mergeStringLists(Array.isArray(meta.urls) ? meta.urls : [], effective.extractedUrls),
      confirmedAt,
    };
    if (capture.agentSessionId) nextMeta.agentSessionId = capture.agentSessionId;
    if (capture.agentTargetId) nextMeta.agentTargetId = capture.agentTargetId;
    if (capture.providerId) nextMeta.providerId = capture.providerId;
    else if (capture.agentProvider) nextMeta.providerId = capture.agentProvider;
    const nextBody = skipBodyInsert
      ? body
      : insertHeading
        ? insertAtHeading(body, insertHeading, incomingBody)
        : `${body}\n\n## Captured ${confirmedAt.slice(0, 10)}\n\n${incomingBody}`;
    const nextSummary = skipBodyInsert
      ? String(meta.summary || existing.summary || "")
      : incomingBody.replace(/\s+/g, " ").trim().slice(0, 900) || String(meta.summary || "");
    if (nextSummary) nextMeta.summary = nextSummary;
    const nextMarkdown = buildFrontmatter(nextMeta) + "\n\n" + nextBody.trim() + "\n";
    const nextItem: Item = {
      ...existing,
      summary: nextSummary || existing.summary,
      tags: Array.isArray(nextMeta.tags) ? (nextMeta.tags as string[]) : existing.tags,
      confirmedAt,
    };
    await this.mutex.run(async () => {
      await writeFile(filePath, nextMarkdown, "utf-8");
      const items = await this.readIndex();
      const nextIndex = items.map((item) => (item.id === id ? nextItem : item));
      await writeFile(
        this.indexPath,
        nextIndex.map((item) => JSON.stringify(item)).join("\n") + (nextIndex.length ? "\n" : ""),
        "utf-8",
      );
    });
    return nextItem;
  }

  async deleteItem(id: string): Promise<Item> {
    const existing = await this.findItem(id);
    if (!existing) throw new Error(`item ${id} was not found`);
    await this.mutex.run(async () => {
      await rm(join(this.dataDir, existing.path), { force: true });
      const items = await this.readIndex();
      const nextIndex = items.filter((item) => item.id !== id);
      await writeFile(
        this.indexPath,
        nextIndex.map((item) => JSON.stringify(item)).join("\n") + (nextIndex.length ? "\n" : ""),
        "utf-8",
      );
    });
    return existing;
  }

  async writeItem(
    intent: Intent,
    classification: Classification,
    content: string,
    capture: Capture,
    edits: ConfirmEdits,
    suffix = "",
  ): Promise<Item> {
    const effective = applyEdits(classification, edits);
    const folder = INTENT_DIRS[intent];
    const itemId = capture.id + (suffix ? `-${suffix}` : "");
    const title = effective.title || "Capture";
    const filename = `${todayStamp()}-${slugify(title, itemId)}.md`;
    const relative = `${folder}/${filename}`;
    const confirmedAt = nowIso();
    const summary = (effective.summary || "").trim().slice(0, 900);
    const urgency = intent === "todo" ? (parsePriorityLevel(edits.urgency) ?? 2) : undefined;
    const importance = intent === "todo" ? (parsePriorityLevel(edits.importance) ?? 2) : undefined;
    const meta: Record<string, unknown> = {
      id: itemId,
      type: intent,
      status: "confirmed",
      source: capture.source || "paste",
      title,
      summary,
      createdAt: capture.createdAt || confirmedAt,
      confirmedAt,
      tags: effective.tags,
      urls: effective.extractedUrls,
    };
    if (urgency !== undefined) meta.urgency = urgency;
    if (importance !== undefined) meta.importance = importance;
    if (intent === "todo") meta.todoProgress = "todo";
    if (capture.agentSessionId) meta.agentSessionId = capture.agentSessionId;
    if (capture.agentTargetId) meta.agentTargetId = capture.agentTargetId;
    if (capture.providerId) meta.providerId = capture.providerId;
    else if (capture.agentProvider) meta.providerId = capture.agentProvider;
    const document = buildFrontmatter(meta) + "\n\n" + buildBody(intent, effective, content, edits);
    const entry: Item = {
      id: itemId,
      type: intent,
      title,
      summary: summary || undefined,
      path: relative,
      status: "confirmed",
      tags: effective.tags,
      urgency,
      importance,
      todoProgress: intent === "todo" ? "todo" : undefined,
      createdAt: String(meta.createdAt),
      confirmedAt,
    };
    await this.mutex.run(async () => {
      await mkdir(join(this.dataDir, folder), { recursive: true });
      await writeFile(join(this.dataDir, relative), document, "utf-8");
      await appendFile(this.indexPath, JSON.stringify(entry) + "\n", "utf-8");
    });
    return entry;
  }

  async rebuildIndex(): Promise<Item[]> {
    const entries: Item[] = [];
    for (const [intent, folder] of Object.entries(INTENT_DIRS) as Array<[Intent, string]>) {
      let names: string[] = [];
      try {
        names = (await readdir(join(this.dataDir, folder))).filter((name) => name.endsWith(".md"));
      } catch {
        continue;
      }
      for (const name of names) {
        const meta = parseFrontmatter(await readFile(join(this.dataDir, folder, name), "utf-8"));
        const id = String(meta.id || name.replace(/\.md$/, ""));
        if (entries.some((existing) => existing.id === id)) continue;
        entries.push(itemFromFrontmatter(meta, (meta.type as Intent) || intent, `${folder}/${name}`));
      }
    }
    entries.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    await this.mutex.run(() =>
      writeFile(this.indexPath, entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : ""), "utf-8"),
    );
    return entries;
  }
}

function normalizeStoredCapture(value: unknown): Capture {
  const capture = value as Capture;
  return {
    ...capture,
    agentTargetId: capture.agentTargetId ?? null,
    providerId: capture.providerId ?? capture.agentProvider ?? null,
  };
}

// -- frontmatter + body ----------------------------------------------------

function applyEdits(classification: Classification, edits: ConfirmEdits): Classification {
  const next = { ...classification };
  if (edits.title && edits.title.trim()) next.title = edits.title.trim().slice(0, 120);
  if (Array.isArray(edits.tags)) next.tags = edits.tags.map((t) => t.trim()).filter(Boolean).slice(0, 5);
  return next;
}

function parsePriorityLevel(value: unknown): PriorityLevel | undefined {
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3) return n;
  return undefined;
}

function parseTodoProgress(value: unknown): TodoProgress | undefined {
  const text = String(value || "").trim();
  return text === "todo" || text === "doing" || text === "done" ? text : undefined;
}

function itemFromFrontmatter(meta: Record<string, unknown>, type: Intent, path: string): Item {
  const id = String(meta.id || path.replace(/\.md$/, ""));
  return {
    id,
    type,
    title: String(meta.title || id),
    summary: String(meta.summary || "").trim() || undefined,
    path,
    status: "confirmed",
    tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : [],
    urgency: parsePriorityLevel(meta.urgency),
    importance: parsePriorityLevel(meta.importance),
    todoProgress: parseTodoProgress(meta.todoProgress),
    createdAt: String(meta.createdAt || ""),
    confirmedAt: String(meta.confirmedAt || ""),
  };
}

function yamlScalar(value: unknown): string {
  const text = String(value);
  // Quote when the value contains structural characters, has surrounding
  // whitespace, or begins with a YAML indicator that would change its meaning.
  if (text === "" || /[:#[\]{}"'\n]/.test(text) || /^[-?*&!|>%@`,]/.test(text) || text !== text.trim()) {
    return JSON.stringify(text);
  }
  return text;
}

function yamlList(values: unknown[]): string {
  return "[" + values.map((v) => JSON.stringify(String(v))).join(", ") + "]";
}

export function buildFrontmatter(meta: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(meta)) {
    lines.push(Array.isArray(value) ? `${key}: ${yamlList(value)}` : `${key}: ${yamlScalar(value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

export function parseFrontmatter(text: string): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  if (!text.startsWith("---")) return meta;
  const lines = text.split("\n").slice(1);
  for (const line of lines) {
    if (line.trim() === "---") break;
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!;
    const raw = match[2]!.trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        meta[key] = JSON.parse(raw);
      } catch {
        meta[key] = [];
      }
    } else if (raw.startsWith('"') && raw.endsWith('"')) {
      try {
        meta[key] = JSON.parse(raw);
      } catch {
        meta[key] = raw.slice(1, -1);
      }
    } else {
      meta[key] = raw;
    }
  }
  return meta;
}

function buildBody(intent: Intent, classification: Classification, content: string, edits?: ConfirmEdits): string {
  const withPreview =
    edits?.bodyPreview?.trim() ?
      { ...classification, savePlan: { mode: "new" as const, reason: "", bodyPreview: edits.bodyPreview.trim() } }
    : classification;
  if (intent === "bookmark") return bookmarkBody(withPreview, content);
  if (intent === "todo") return todoBody(withPreview, content);
  return noteBody(withPreview, content);
}

function noteBody(classification: Classification, content: string): string {
  const preview = classification.savePlan?.bodyPreview?.trim();
  if (preview) {
    const urls = classification.extractedUrls || [];
    if (urls.length && !previewAlreadyHasSources(preview, urls)) {
      return `${preview}\n\n## Source\n${urls.map((url) => `- ${url}`).join("\n")}\n`;
    }
    return `${preview}\n`;
  }
  const parts: string[] = [];
  const summary = classification.summary || content.trim().slice(0, 400);
  if (summary) parts.push(summary);
  const urls = classification.extractedUrls || [];
  if (urls.length) parts.push("## Source\n" + urls.map((url) => `- ${url}`).join("\n"));
  parts.push("## Original\n" + content.trim());
  return parts.join("\n\n").trim() + "\n";
}

function previewAlreadyHasSources(preview: string, urls: string[]): boolean {
  if (/^#{1,6}\s*source\b/im.test(preview) || /^#{1,6}\s*来源/m.test(preview)) return true;
  const lower = preview.toLowerCase();
  const covered = urls.filter((url) => lower.includes(url.toLowerCase()));
  return covered.length >= Math.min(urls.length, 1);
}

function normalizeUrlForCompare(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return url.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
  }
}

function significantTerms(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
  return [...new Set(words)].slice(0, 24);
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "article",
  "content",
  "from",
  "have",
  "into",
  "paper",
  "that",
  "this",
  "with",
  "中文",
  "摘要",
  "文章",
  "论文",
]);

function excerptMarkdown(markdown: string): string {
  const bodyStart = markdown.indexOf("\n---\n", 4);
  const body = bodyStart >= 0 ? markdown.slice(bodyStart + 5) : markdown;
  return body.replace(/\s+/g, " ").trim().slice(0, 700);
}

function extractDois(text: string): string[] {
  const matches = text.match(/\b10\.\d{4,9}\/[^\s"'<>]+/gi) || [];
  return [...new Set(matches.map((doi) => doi.toLowerCase().replace(/[.,;)\]]+$/, "")))];
}

function extractArxivIds(text: string): string[] {
  const ids: string[] = [];
  const urlMatches = text.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/gi) || [];
  for (const match of urlMatches) {
    const id = match.split("/").pop()?.replace(/\.pdf$/i, "");
    if (id) ids.push(id.toLowerCase());
  }
  const bareMatches = text.match(/\barxiv:(\d{4}\.\d{4,5}(?:v\d+)?)\b/gi) || [];
  for (const match of bareMatches) {
    ids.push(match.split(":")[1]!.toLowerCase());
  }
  return [...new Set(ids)];
}

function extractHashTags(text: string): string[] {
  return [...new Set((text.match(/#([\p{L}\p{N}_-]{2,})/gu) || []).map((tag) => tag.slice(1).toLowerCase()))];
}

function extractMarkdownHeadings(body: string): string[] {
  const headings: string[] = [];
  for (const line of body.split("\n")) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (match) headings.push(match[1]!.trim());
  }
  return headings;
}

function looksLikeCollectionNote(title: string, tags: string[], body: string): boolean {
  const blob = [title, tags.join(" "), body.slice(0, 1200)].join(" ").toLowerCase();
  return /汇总|合集|阅读笔记|reading summary|paper reading|toolbox|tool collection|knowledge base|资料库|collection/.test(
    blob,
  );
}

function mergeStringLists(left: unknown[], right: unknown[]): string[] {
  const result: string[] = [];
  for (const value of [...left, ...right]) {
    const text = String(value || "").trim();
    if (text && !result.includes(text)) result.push(text);
  }
  return result.slice(0, 12);
}

function shouldSkipMergeBody(
  markdown: string,
  content: string,
  classification: Classification,
  incomingBody: string,
): boolean {
  const incoming = incomingBody.trim();
  if (!incoming) return true;
  const bodyStart = markdown.indexOf("\n---\n", 4);
  const body = (bodyStart >= 0 ? markdown.slice(bodyStart + 5) : markdown).trim();
  if (incoming.length >= 32) {
    const needle = incoming.slice(0, Math.min(incoming.length, 180));
    return body.includes(needle);
  }
  return isAlreadyCaptured(markdown, content, classification);
}

function isAlreadyCaptured(markdown: string, content: string, classification: Classification): boolean {
  const haystack = markdown.toLowerCase();
  const urls = classification.extractedUrls.length ? classification.extractedUrls : extractUrls(content);
  if (urls.some((url) => haystack.includes(normalizeUrlForCompare(url)) || haystack.includes(url.toLowerCase()))) {
    return true;
  }
  const title = classification.title.trim().toLowerCase();
  return title.length >= 12 && haystack.includes(title);
}

function bookmarkBody(classification: Classification, content: string): string {
  const preview = classification.savePlan?.bodyPreview?.trim();
  if (preview) return `${preview}\n`;
  const urls = classification.extractedUrls?.length ? classification.extractedUrls : extractUrls(content);
  if (!urls.length) return content.trim() + "\n";
  return (
    urls
      .map((url) => {
        let host = url;
        try {
          host = new URL(url).host || url;
        } catch {
          /* keep url */
        }
        return `- [${host}](${url})`;
      })
      .join("\n") + "\n"
  );
}

function todoBody(classification: Classification, content: string): string {
  const tasks = classification.extractedTasks?.length
    ? classification.extractedTasks
    : ruleTasks(content).length
      ? ruleTasks(content)
      : [content.trim()];
  return tasks.filter(Boolean).map((task) => `- [ ] ${task}`).join("\n") + "\n";
}

function replaceTodoCheckbox(markdown: string, taskIndex: number, completed: boolean): string {
  if (!Number.isInteger(taskIndex) || taskIndex < 0) throw new Error("valid taskIndex is required");
  let seen = -1;
  let changed = false;
  const lines = markdown.split("\n").map((line) => {
    const match = line.match(/^(\s*[-*]\s+\[)( |x|X)(\]\s+.*)$/);
    if (!match) return line;
    seen += 1;
    if (seen !== taskIndex) return line;
    changed = true;
    return `${match[1]}${completed ? "x" : " "}${match[3]}`;
  });
  if (!changed) throw new Error(`todo task ${taskIndex} was not found`);
  return lines.join("\n");
}

function inferTodoProgress(markdown: string): TodoProgress {
  const states = markdown
    .split("\n")
    .map((line) => line.match(/^\s*[-*]\s+\[( |x|X)\]\s+/)?.[1])
    .filter((value): value is string => Boolean(value));
  if (!states.length) return "todo";
  const completed = states.filter((value) => value.toLowerCase() === "x").length;
  if (completed === states.length) return "done";
  if (completed > 0) return "doing";
  return "todo";
}
