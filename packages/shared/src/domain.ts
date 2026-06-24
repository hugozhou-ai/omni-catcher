/** Persisted item intents (and transient classification-only values). */
export type Intent = "note" | "bookmark" | "todo" | "mixed";
export type ClassificationIntent = Intent | "clarify";

export type CaptureStatus = "classifying" | "classified" | "needs_review";
export type CaptureSource = "paste" | "url" | "cli";
export type CaptureProgress =
  | "preparing"
  | "finding_related"
  | "preparing_context"
  | "fetching_pages"
  | "browser_pages"
  | "calling_agent"
  | "finalizing"
  | "fallback";

export interface TodoUpgrade {
  agentCompletable: boolean;
  suggestedIssueTitle: string;
}

export interface MergePreview {
  targetItemId?: string;
  targetTitle: string;
  existingContent: string;
  insertedContent: string;
}

export interface RelatedItem {
  id: string;
  type: Intent;
  title: string;
  summary?: string;
  path: string;
  tags: string[];
  score: number;
  reason: string;
  excerpt?: string;
}

export interface MixedItem {
  type: Intent;
  title?: string;
  summary?: string;
  url?: string;
  tags?: string[];
  tasks?: string[];
}

export interface Classification {
  primaryIntent: ClassificationIntent;
  confidence: number;
  alternatives: Array<{ intent: Intent; reason: string }>;
  title: string;
  summary: string;
  tags: string[];
  extractedUrls: string[];
  extractedTasks: string[];
  items: MixedItem[];
  relatedItems?: RelatedItem[];
  mergePreview?: MergePreview | null;
  todoUpgrade: TodoUpgrade;
  /** "agent" | "rule" | "rule-fallback" */
  source: string;
}

export interface Capture {
  id: string;
  status: CaptureStatus;
  source: CaptureSource;
  content: string;
  url: string;
  createdAt: string;
  rulePreview: Classification;
  classification: Classification | null;
  agentSessionId: string | null;
  agentProvider: string | null;
  error: string | null;
  progress?: CaptureProgress;
}

export interface Item {
  id: string;
  type: Intent;
  title: string;
  summary?: string;
  path: string;
  status: "confirmed";
  tags: string[];
  urgency?: PriorityLevel;
  importance?: PriorityLevel;
  createdAt: string;
  confirmedAt: string;
}

export interface AgentProvider {
  provider: string;
  status: string;
}

export interface AgentProvidersResult {
  available: boolean;
  providers: AgentProvider[];
  defaultProvider: string;
  error?: string;
}

export interface WorkspaceContext {
  workspaceId: string;
  workspaceName: string;
  workspaceRoot: string;
  dataDir: string;
}

/** 1 = low, 2 = medium, 3 = high */
export type PriorityLevel = 1 | 2 | 3;

export interface ConfirmEdits {
  title?: string;
  tags?: string[];
  urgency?: PriorityLevel;
  importance?: PriorityLevel;
}

export interface ItemMetaUpdate {
  urgency?: PriorityLevel;
  importance?: PriorityLevel;
}

export interface ConfirmResult {
  items: Item[];
  issue: IssueResult | null;
}

export interface IssueResult {
  created: boolean;
  issue?: unknown;
  error?: string;
}
