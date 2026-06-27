import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import type {
  ReferenceItem,
  ReferenceListReferenceItem,
  ReferenceListRequest,
  ReferenceSearchRequest,
  ReferenceSearchResponse,
} from "@omni-catcher/shared";
import type { IStorageService } from "./storageService.js";

export interface IReferenceService {
  search(request: ReferenceSearchRequest): Promise<ReferenceSearchResponse>;
  list(request: ReferenceListRequest): Promise<ReferenceSearchResponse>;
}

export const IReferenceService = createServiceIdentifier<IReferenceService>("referenceService");

export class ReferenceService implements IReferenceService {
  constructor(private readonly storage: IStorageService) {}

  /** Global search: match query against title, summary, tags, and Markdown body. */
  async search(request: ReferenceSearchRequest): Promise<ReferenceSearchResponse> {
    const query = (request.query || "").trim().toLowerCase();
    const limit = clampLimit(request.limit);
    if (!query) {
      const items = (await this.fileReferences())
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .slice(0, limit)
        .map(wrapReference);
      return { items, nextCursor: null };
    }
    const matches = await this.storage.searchItems(query);
    const refs = await this.fileReferences();
    const byPath = new Map(refs.map((ref) => [ref.location.path, ref]));
    const items = matches
      .map((item) => byPath.get(item.path))
      .filter((ref): ref is ReferenceItem => Boolean(ref))
      .slice(0, limit)
      .map(wrapReference);
    return { items, nextCursor: null };
  }

  /** Browse listing: flat (no groups), with optional per-level text filter. */
  async list(request: ReferenceListRequest): Promise<ReferenceSearchResponse> {
    if ((request.parentGroupId || "").trim()) {
      return { items: [], nextCursor: null };
    }
    const filter = (request.filterText || "").trim().toLowerCase();
    const items = (await this.fileReferences())
      .filter((ref) => (filter ? ref.displayName.toLowerCase().includes(filter) : true))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(0, 50)
      .map(wrapReference);
    return { items, nextCursor: null };
  }

  private async fileReferences(): Promise<ReferenceItem[]> {
    const items = await this.storage.listItems();
    const refs: ReferenceItem[] = [];
    for (const item of items) {
      let sizeBytes: number | undefined;
      let mtimeMs: number | undefined;
      try {
        const stats = await stat(join(this.storage.dataDir, item.path));
        sizeBytes = stats.size;
        mtimeMs = Math.round(stats.mtimeMs);
      } catch {
        continue;
      }
      refs.push({
        kind: "file",
        displayName: item.title || item.id,
        description: [item.type, item.summary || "", (item.tags || []).join(", ")].filter(Boolean).join(" · "),
        location: { type: "app-data-relative", path: item.path },
        sizeBytes,
        mtimeMs,
        mimeType: "text/markdown",
      });
    }
    return refs;
  }
}

function clampLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(Number(limit) || 5, 50));
}

function wrapReference(reference: ReferenceItem): ReferenceListReferenceItem {
  return { type: "reference", reference };
}
