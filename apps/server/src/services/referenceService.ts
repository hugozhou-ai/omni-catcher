import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import type { ReferenceItem, ReferenceSearchRequest, ReferenceSearchResponse } from "@omni-catcher/shared";
import type { IStorageService } from "./storageService.js";

export interface IReferenceService {
  search(request: ReferenceSearchRequest): Promise<ReferenceSearchResponse>;
}

export const IReferenceService = createServiceIdentifier<IReferenceService>("referenceService");

export class ReferenceService implements IReferenceService {
  constructor(private readonly storage: IStorageService) {}

  async search(request: ReferenceSearchRequest): Promise<ReferenceSearchResponse> {
    const query = (request.query || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(Number(request.limit) || 5, 50));
    const references: ReferenceItem[] = [];
    for (const item of await this.storage.listItems()) {
      const blob = [item.title, item.type, (item.tags || []).join(" "), item.path].join(" ").toLowerCase();
      const score = !query ? 1 : blob.includes(query) ? 0.9 : 0;
      if (score <= 0) continue;
      references.push({
        kind: "file",
        displayName: item.title || item.id,
        description: item.type,
        location: { type: "app-data-relative", path: item.path },
        score,
      });
    }
    references.sort((a, b) => (b.score || 0) - (a.score || 0) || a.displayName.localeCompare(b.displayName));
    return { references: references.slice(0, limit), nextCursor: null };
  }
}
