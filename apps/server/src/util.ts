import { randomBytes } from "node:crypto";

/** Serializes async sections so concurrent requests cannot corrupt index/files. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function captureId(): string {
  return "cap_" + randomBytes(6).toString("hex");
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

const URL_RE = /https?:\/\/[^\s<>"')]+/g;

export function extractUrls(text: string): string[] {
  const seen: string[] = [];
  for (const match of (text || "").matchAll(URL_RE)) {
    const url = match[0].replace(/[.,;)]+$/, "");
    if (!seen.includes(url)) seen.push(url);
  }
  return seen;
}

export function firstNonemptyLine(text: string): string {
  for (const line of (text || "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return stripListMarker(trimmed);
  }
  return "";
}

/** Drop a leading markdown list / checkbox / heading marker so titles read cleanly. */
export function stripListMarker(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^([-*+]|\d+[.)])\s+/, "")
    .replace(/^\[[ xX]?\]\s+/, "")
    .trim();
}

export function slugify(value: string, fallback: string): string {
  let slug = (value || "").trim().toLowerCase();
  slug = slug.replace(/[^\w\u4e00-\u9fff]+/gu, "-").replace(/^-+|-+$/g, "");
  if (!slug) return fallback;
  return slug.slice(0, 48).replace(/^-+|-+$/g, "") || fallback;
}
