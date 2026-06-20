export type Locale = "en" | "zh-CN";

export interface Messages {
  appName: string;
  captureTitle: string;
  capturePlaceholder: string;
  captureButton: string;
  pendingTitle: string;
  libraryTitle: string;
  searchPlaceholder: string;
  classifying: string;
  needsReview: string;
  confidence: string;
  title: string;
  tags: string;
  confirm: string;
  reject: string;
  writeIssue: string;
  tabAll: string;
  tabNote: string;
  tabBookmark: string;
  tabTodo: string;
  emptyPending: string;
  emptyLibrary: string;
  saved: string;
  discarded: string;
  providerReady: string;
  providerNone: string;
  intentNote: string;
  intentBookmark: string;
  intentTodo: string;
  intentMixed: string;
}

export function normalizeLocale(value: string | null | undefined): Locale {
  const v = String(value || "").replace("_", "-").toLowerCase();
  if (v === "zh" || v.startsWith("zh-")) return "zh-CN";
  return "en";
}
