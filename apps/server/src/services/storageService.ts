import { mkdir, readFile, readdir, writeFile, appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { URL } from "node:url";
import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import type { Capture, Classification, ConfirmEdits, Intent, Item, ItemMetaUpdate, PriorityLevel } from "@omni-catcher/shared";
import type { AppConfig } from "../config.js";
import { Mutex, extractUrls, nowIso, slugify, todayStamp } from "../util.js";
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
  updateItemMeta(id: string, update: ItemMetaUpdate): Promise<Item>;
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
  readonly dataDir: string;
  private readonly inboxDir: string;
  private readonly indexPath: string;
  private readonly settingsPath: string;

  constructor(config: AppConfig) {
    this.dataDir = config.dataDir;
    this.inboxDir = join(this.dataDir, "inbox");
    this.indexPath = join(this.dataDir, "index.jsonl");
    this.settingsPath = join(this.dataDir, "settings.json");
  }

  async init(): Promise<void> {
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
      return JSON.parse(await readFile(this.capturePath(id), "utf-8")) as Capture;
    } catch {
      return null;
    }
  }

  async writeCapture(capture: Capture): Promise<Capture> {
    await this.mutex.run(() =>
      writeFile(this.capturePath(capture.id), JSON.stringify(capture, null, 2), "utf-8"),
    );
    return capture;
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
        captures.push(JSON.parse(await readFile(join(this.inboxDir, name), "utf-8")) as Capture);
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

  async updateItemMeta(id: string, update: ItemMetaUpdate): Promise<Item> {
    const existing = await this.findItem(id);
    if (!existing) throw new Error(`item ${id} was not found`);
    const filePath = join(this.dataDir, existing.path);
    const markdown = await readFile(filePath, "utf-8");
    const meta = parseFrontmatter(markdown);
    if (update.urgency !== undefined) meta.urgency = update.urgency;
    if (update.importance !== undefined) meta.importance = update.importance;
    const bodyStart = markdown.indexOf("\n---\n", 4);
    const body = bodyStart >= 0 ? markdown.slice(bodyStart + 5) : markdown;
    const nextMarkdown = buildFrontmatter(meta) + "\n" + body;
    const nextItem: Item = {
      ...existing,
      urgency: parsePriorityLevel(meta.urgency) ?? existing.urgency,
      importance: parsePriorityLevel(meta.importance) ?? existing.importance,
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
    const summary = (effective.summary || "").trim().slice(0, 500);
    const urgency = intent === "todo" ? (edits.urgency ?? 2) : undefined;
    const importance = intent === "todo" ? (edits.importance ?? 2) : undefined;
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
    if (capture.agentSessionId) meta.agentSessionId = capture.agentSessionId;
    if (capture.agentProvider) meta.agentProvider = capture.agentProvider;
    const document = buildFrontmatter(meta) + "\n\n" + buildBody(intent, effective, content);
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

function buildBody(intent: Intent, classification: Classification, content: string): string {
  if (intent === "bookmark") return bookmarkBody(classification, content);
  if (intent === "todo") return todoBody(classification, content);
  return noteBody(classification, content);
}

function noteBody(classification: Classification, content: string): string {
  const parts: string[] = [];
  const summary = classification.summary || content.trim().slice(0, 400);
  if (summary) parts.push(summary);
  const urls = classification.extractedUrls || [];
  if (urls.length) parts.push("## Source\n" + urls.map((url) => `- ${url}`).join("\n"));
  parts.push("## Original\n" + content.trim());
  return parts.join("\n\n").trim() + "\n";
}

function bookmarkBody(classification: Classification, content: string): string {
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
