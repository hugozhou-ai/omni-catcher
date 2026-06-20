import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import type { AgentProvider, AgentProvidersResult } from "@omni-catcher/shared";
import type { ITuttiCliService } from "./tuttiCliService.js";

export interface AgentRunResult {
  text: string;
  sessionId: string;
  provider: string;
}

export interface IAgentService {
  listProviders(): Promise<AgentProvidersResult>;
  resolveProvider(preferred?: string): Promise<string>;
  resolveModel(provider: string): Promise<string>;
  runPrompt(prompt: string, title: string, timeoutMs: number, preferred?: string): Promise<AgentRunResult>;
}

export const IAgentService = createServiceIdentifier<IAgentService>("agentService");

const SUPPORTED = new Set(["codex", "claude-code", "gemini"]);
const DEFAULT_PROVIDER = "codex";

export function normalizeProvider(value: unknown): string {
  const v = String(value || "").trim().toLowerCase();
  const aliases: Record<string, string> = { claude: "claude-code", "gemini-cli": "gemini" };
  return aliases[v] || v;
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
        if (!SUPPORTED.has(provider) || !["available", "ready"].includes(status)) continue;
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
    return wanted || DEFAULT_PROVIDER;
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

  async runPrompt(prompt: string, title: string, timeoutMs: number, preferred?: string): Promise<AgentRunResult> {
    let provider = await this.resolveProvider(preferred);
    const model = await this.resolveModel(provider);
    const args = [
      "agent",
      "start",
      "--provider",
      provider,
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
    if (model) args.push("--model", model);

    const start = await this.cli.run(args, 60_000);
    const startSession = (start.session as Record<string, unknown>) || {};
    const sessionId = String(startSession.agentSessionId || "").trim();
    if (!sessionId) throw new Error("agent session was not created");
    provider = normalizeProvider(startSession.provider) || provider;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
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
      const text = await this.completedAssistantText(sessionId);
      if (text) return { text, sessionId, provider };
      await delay(2000);
    }
    throw new Error("agent timed out before producing a result");
  }

  private async completedAssistantText(sessionId: string): Promise<string | null> {
    const result = await this.cli.run(
      ["agent", "session-summary", "--session-id", sessionId, "--limit", "80"],
      30_000,
    );
    const latestVersion = Number(result.latestVersion || 0);
    const messages = ((result.messages as unknown[]) || []).filter(
      (m): m is Record<string, unknown> => Boolean(m) && typeof m === "object",
    );
    // The turn is finished only when the newest message is a completed assistant
    // reply; while it is still streaming the latest message is in-progress.
    const latest = messages.find((m) => Number(m.version || 0) === latestVersion);
    if (!latest) return null;
    const role = String(latest.role || "").trim().toLowerCase();
    const status = String(latest.status || "").trim().toLowerCase();
    if (role !== "assistant" && role !== "agent") return null;
    if (status !== "completed") return null;
    return messageText(latest);
  }
}

function messageText(message: Record<string, unknown>): string | null {
  if (typeof message.text === "string" && message.text.trim()) return message.text.trim();
  return extractMessageText(message.payload);
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
    for (const key of ["content", "text", "markdown", "message"]) {
      const text = extractMessageText(obj[key]);
      if (text) return text;
    }
    for (const key of ["parts", "items"]) {
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
