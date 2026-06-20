/** Reference search contract for `@omni-catcher` mentions. */
export interface ReferenceSearchRequest {
  query?: string;
  limit?: number;
  cursor?: string;
  kinds?: string[];
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
}

export interface ReferenceSearchResponse {
  references: ReferenceItem[];
  nextCursor: string | null;
}
