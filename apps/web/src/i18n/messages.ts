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
  providerLabel: string;
  providerDefaultOption: string;
  intentNote: string;
  intentBookmark: string;
  intentTodo: string;
  intentMixed: string;
  navHome: string;
  navTodo: string;
  navNote: string;
  navBookmark: string;
  urgency: string;
  importance: string;
  priorityLow: string;
  priorityMedium: string;
  priorityHigh: string;
  sortCreated: string;
  sortUrgency: string;
  sortImportance: string;
  filterUrgencyAll: string;
  filterImportanceAll: string;
  viewList: string;
  viewMatrix: string;
  matrixQ1: string;
  matrixQ2: string;
  matrixQ3: string;
  matrixQ4: string;
}

export function normalizeLocale(value: string | null | undefined): Locale {
  const v = String(value || "").replace("_", "-").toLowerCase();
  if (v === "zh" || v.startsWith("zh-")) return "zh-CN";
  return "en";
}
