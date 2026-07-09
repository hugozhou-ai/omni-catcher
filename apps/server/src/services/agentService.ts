import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import type { AgentProvider, AgentProvidersResult } from "@omni-catcher/shared";
import type { ITuttiCliService } from "./tuttiCliService.js";

export interface AgentRunResult {
  text: string;
  sessionId: string;
  provider: string;
}

export interface AgentRunCallbacks {
  isCanceled?(): boolean | Promise<boolean>;
  onStarted?(sessionId: string, provider: string): void | Promise<void>;
  onActivity?(activityText: string): void | Promise<void>;
}

export interface IAgentService {
  listProviders(): Promise<AgentProvidersResult>;
  resolveProvider(preferred?: string): Promise<string>;
  resolveModel(provider: string): Promise<string>;
  runPrompt(
    prompt: string,
    title: string,
    timeoutMs: number,
    preferred?: string,
    callbacks?: AgentRunCallbacks,
  ): Promise<AgentRunResult>;
  cancelSession(sessionId: string): Promise<void>;
}

export const IAgentService = createServiceIdentifier<IAgentService>("agentService");

const START_COMMAND_ALIASES: Record<string, string> = {
  "claude-code": "claude",
  nexight: "tutti-agent",
};

export function normalizeProvider(value: unknown): string {
  const v = String(value || "").trim().toLowerCase();
  const aliases: Record<string, string> = {
    claude: "claude-code",
    "gemini-cli": "gemini",
    nexight: "tutti-agent",
  };
  return aliases[v] || v;
}

function providerStartCommand(provider: string): string | null {
  return START_COMMAND_ALIASES[provider] ?? provider;
}

export class AgentService implements IAgentService {
  private readonly modelCache = new Map<string, string>();

  constructor(private readonly cli: ITuttiCliService) {}

  async listProviders(): Promise<AgentProvidersResult> {
    try {
      const result = await this.cli.run(["agent", "providers"], 30_000);
      const providers: AgentProvider[] = [];
      for (const raw of (result.providers as unknown[]) || []) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        const provider = normalizeProvider(item.provider);
        const status = String(item.status || "").trim().toLowerCase();
        if (!provider || !["available", "ready"].includes(status)) continue;
        providers.push({ provider, status });
      }
      return {
        available: providers.length > 0,
        providers,
        defaultProvider: normalizeProvider(result.defaultProvider),
      };
    } catch (error) {
      return { available: false, providers: [], defaultProvider: "", error: (error as Error).message };
    }
  }

  async resolveProvider(preferred?: string): Promise<string> {
    const payload = await this.listProviders();
    const available = payload.providers.map((item) => item.provider);
    const wanted = normalizeProvider(preferred);
    if (wanted && available.includes(wanted)) return wanted;
    if (payload.defaultProvider && available.includes(payload.defaultProvider)) return payload.defaultProvider;
    if (available.length) return available[0]!;
    return wanted || "";
  }

  async resolveModel(provider: string): Promise<string> {
    const cached = this.modelCache.get(provider);
    if (cached) return cached;
    try {
      const result = await this.cli.run(["agent", "composer-options", "--provider", provider], 30_000);
      const config = (result.modelConfig as Record<string, unknown>) || {};
      const settings = (result.effectiveSettings as Record<string, unknown>) || {};
      const model = String(config.defaultValue || config.currentValue || settings.model || "").trim();
      if (model) this.modelCache.set(provider, model);
      return model;
    } catch {
      return "";
    }
  }

  async runPrompt(
    prompt: string,
    title: string,
    timeoutMs: number,
    preferred?: string,
    callbacks?: AgentRunCallbacks,
  ): Promise<AgentRunResult> {
    if (await callbacks?.isCanceled?.()) throw new Error("agent session was canceled");
    let provider = await this.resolveProvider(preferred);
    if (!provider) throw new Error("no agent provider is available");
    const model = (await this.resolveModel(provider)) || "";
    if (!model) throw new Error(`no model available for provider ${provider}`);
    const command = providerStartCommand(provider);
    if (!command) throw new Error(`unsupported agent provider ${provider}`);
    const args = [
      command,
      "start",
      "--prompt",
      prompt,
      "--title",
      title,
      "--visible",
      "false",
      "--permission-mode",
      "auto",
      "--cwd",
      process.env.TUTTI_APP_DATA_DIR || process.cwd(),
    ];
    args.push("--model", model);

    const start = await this.cli.run(args, 60_000);
    const startSession = (start.session as Record<string, unknown>) || {};
    const sessionId = String(startSession.agentSessionId || "").trim();
    if (!sessionId) throw new Error("agent session was not created");
    provider = normalizeProvider(startSession.provider) || provider;
    await callbacks?.onStarted?.(sessionId, provider);
    if (await callbacks?.isCanceled?.()) {
      await this.cancelSession(sessionId).catch(() => undefined);
      throw new Error("agent session was canceled");
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await callbacks?.isCanceled?.()) {
        await this.cancelSession(sessionId).catch(() => undefined);
        throw new Error("agent session was canceled");
      }
      // Hard failures (e.g. provider rate limit) surface on the session record.
      const info = await this.cli.run(["agent", "get", "--session-id", sessionId], 30_000);
      const session = (info.session as Record<string, unknown>) || {};
      const status = String(session.status || "").trim().toLowerCase();
      const lastError = String(session.lastError || "").trim();
      if (["failed", "error", "errored"].includes(status)) {
        throw new Error(lastError || "agent session failed");
      }
      if (["canceled", "cancelled"].includes(status)) {
        throw new Error("agent session was canceled");
      }

      // ACP providers (e.g. claude-code) keep the session open after a turn, so the
      // session status stays "created"/"running"; completion is detected from the
      // assistant turn becoming the latest message with a "completed" status.
      const { completedText, activityText } = await this.inspectAssistantMessages(sessionId);
      if (activityText) await callbacks?.onActivity?.(activityText);
      const text = completedText;
      if (text) return { text, sessionId, provider };
      await delay(2000);
    }
    throw new Error("agent timed out before producing a result");
  }

  async cancelSession(sessionId: string): Promise<void> {
    const id = sessionId.trim();
    if (!id) return;
    await this.cli.run(["agent", "cancel", "--session-id", id], 30_000);
  }

  private async inspectAssistantMessages(
    sessionId: string,
  ): Promise<{ completedText: string | null; activityText: string | null }> {
    const result = await this.cli.run(
      ["agent", "session-summary", "--session-id", sessionId, "--limit", "80"],
      30_000,
    );
    const latestVersion = Number(result.latestVersion || 0);
    const messages = ((result.messages as unknown[]) || []).filter(
      (m): m is Record<string, unknown> => Boolean(m) && typeof m === "object",
    );
    const latest = messages.find((m) => Number(m.version || 0) === latestVersion);
    const activityText = latestActivityText(messages);
    if (!latest) return { completedText: null, activityText };

    const latestRole = String(latest.role || "").trim().toLowerCase();
    const latestStatus = String(latest.status || "").trim().toLowerCase();
    const latestIsCompletedAssistant =
      (latestRole === "assistant" || latestRole === "agent") && latestStatus === "completed";

    // Codex may emit completed bootstrap/tool notices before the final JSON reply.
    // Keep polling until the newest completed assistant message looks like JSON.
    const completedAssistant = messages
      .filter((message) => {
        const role = String(message.role || "").trim().toLowerCase();
        const status = String(message.status || "").trim().toLowerCase();
        return (role === "assistant" || role === "agent") && status === "completed";
      })
      .sort((left, right) => Number(right.version || 0) - Number(left.version || 0));

    for (const message of completedAssistant) {
      const text = messageText(message);
      if (text && looksLikeStructuredJsonOutput(text)) return { completedText: text, activityText };
    }

    if (latestIsCompletedAssistant) return { completedText: null, activityText };
    return { completedText: null, activityText };
  }
}

function looksLikeStructuredJsonOutput(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return true;
  return /^```(?:json)?\s*[\[{]/m.test(trimmed);
}

function messageText(message: Record<string, unknown>): string | null {
  if (typeof message.text === "string" && message.text.trim()) return message.text.trim();
  return extractMessageText(message.payload);
}

function latestActivityText(messages: Record<string, unknown>[]): string | null {
  const sorted = [...messages].sort((left, right) => Number(right.version || 0) - Number(left.version || 0));
  for (const message of sorted) {
    const role = String(message.role || "").trim().toLowerCase();
    if (role === "user") continue;
    const status = String(message.status || "").trim().toLowerCase();
    const text = messageText(message);
    const toolActivity = extractToolActivity(message);
    const candidate = toolActivity || text;
    if (!candidate) continue;
    const inProgress = status !== "completed" && status !== "failed" && status !== "cancelled";
    if (inProgress) {
      if (looksLikeStructuredJsonOutput(candidate)) return "Composing classification result…";
      return truncateActivity(candidate);
    }
    if (looksLikeStructuredJsonOutput(candidate)) continue;
    return truncateActivity(candidate);
  }
  return null;
}

function extractToolActivity(message: Record<string, unknown>): string | null {
  const role = String(message.role || message.type || "").trim().toLowerCase();
  const payload = message.payload;
  if (!payload || typeof payload !== "object") {
    if (role.includes("tool")) return messageText(message);
    return null;
  }
  const obj = payload as Record<string, unknown>;
  const toolName = String(obj.toolName || obj.name || obj.tool || obj.kind || "").trim();
  const title = String(obj.title || obj.summary || obj.description || obj.label || "").trim();
  if (toolName && title) return `${toolName}: ${title}`;
  if (toolName) return toolName;
  if (title) return title;
  const type = String(obj.type || "").trim().toLowerCase();
  if (type.includes("tool") || role.includes("tool")) {
    const nested = extractMessageText(obj.input || obj.arguments || obj.args);
    if (nested) return truncateActivity(nested);
  }
  return null;
}

function truncateActivity(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= 240) return compact;
  return `${compact.slice(0, 237)}...`;
}

function extractMessageText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const text = value.map(extractMessageText).filter(Boolean).join("\n");
    return text.trim() || null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["content", "text", "markdown", "message", "thought", "thinking", "reasoning"]) {
      const text = extractMessageText(obj[key]);
      if (text) return text;
    }
    for (const key of ["parts", "items", "blocks"]) {
      if (key in obj) {
        const text = extractMessageText(obj[key]);
        if (text) return text;
      }
    }
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
