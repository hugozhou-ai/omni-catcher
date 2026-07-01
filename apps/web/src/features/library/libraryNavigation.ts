import type { Intent } from "@omni-catcher/shared";

export type LibraryCategory = Exclude<Intent, "mixed">;

export type LibrarySelection = {
  category: LibraryCategory;
  itemId: string | null;
};

export const LIBRARY_CATEGORIES: LibraryCategory[] = ["note", "todo", "bookmark"];

export const DEFAULT_LIBRARY_SELECTION: LibrarySelection = {
  category: "note",
  itemId: null,
};
