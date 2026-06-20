/** Reference contracts for `@omni-catcher` mentions. */
export interface ReferenceTimeRange {
  fromMs?: number;
  toMs?: number;
}

/** Global search picker: required query, matched against displayName only. */
export interface ReferenceSearchRequest {
  query?: string;
  limit?: number;
  cursor?: string;
  kinds?: string[];
  timeRange?: ReferenceTimeRange;
}

/** Browse picker: per-level listing with optional text filter. */
export interface ReferenceListRequest {
  parentGroupId?: string;
  filterText?: string;
  cursor?: string;
  timeRange?: ReferenceTimeRange;
}

export interface ReferenceLocation {
  type: "app-data-relative" | "app-package-relative";
  path: string;
}

export interface ReferenceItem {
  kind: "file";
  displayName: string;
  description?: string;
  location: ReferenceLocation;
  sizeBytes?: number;
  mtimeMs?: number;
  mimeType?: string;
  score?: number;
  parentGroupLabel?: string;
}

/**
 * Each entry in a list/search response is a tagged wrapper. The daemon reads the
 * `type` discriminator first and drops anything that is not `group` or
 * `reference`; a bare file reference (without this wrapper) is silently dropped.
 */
export interface ReferenceListReferenceItem {
  type: "reference";
  reference: ReferenceItem;
}

export interface ReferenceListGroupItem {
  type: "group";
  id: string;
  displayName: string;
  description?: string;
  referenceCount: number;
}

export type ReferenceListItem = ReferenceListReferenceItem | ReferenceListGroupItem;

/**
 * Tutti reference endpoints (list + search) expect `{ items, nextCursor }` where
 * each item is a tagged `{ type, ... }` wrapper.
 */
export interface ReferenceSearchResponse {
  items: ReferenceListItem[];
  nextCursor: string | null;
}
