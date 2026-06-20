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
  runPrompt(prompt: string, title: string, timeoutMs: number): Promise<AgentRunResult>;
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

  async runPrompt(prompt: string, title: string, timeoutMs: number): Promise<AgentRunResult> {
    let provider = await this.resolveProvider();
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
    let outcome: "succeeded" | "failed" | "canceled" | null = null;
    let lastError = "";
    while (Date.now() < deadline) {
      const info = await this.cli.run(["agent", "get", "--session-id", sessionId], 30_000);
      const session = (info.session as Record<string, unknown>) || {};
      lastError = String(session.lastError || "").trim();
      outcome = classifyStatus(session.status);
      if (outcome) break;
      await delay(2000);
    }
    if (outcome === null) throw new Error("agent timed out before producing a result");
    if (outcome === "failed") throw new Error(lastError || "agent session failed");
    if (outcome === "canceled") throw new Error("agent session was canceled");

    const text = await this.latestAssistantText(sessionId);
    if (!text) throw new Error("agent produced no output");
    return { text, sessionId, provider };
  }

  private async latestAssistantText(sessionId: string): Promise<string | null> {
    const result = await this.cli.run(
      ["agent", "session-summary", "--session-id", sessionId, "--limit", "80"],
      30_000,
    );
    const messages = ((result.messages as unknown[]) || []).filter(
      (m): m is Record<string, unknown> => Boolean(m) && typeof m === "object",
    );
    messages.sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
    for (const message of messages) {
      const role = String(message.role || "").trim().toLowerCase();
      const status = String(message.status || "").trim().toLowerCase();
      if ((role === "assistant" || role === "agent") && status !== "failed") {
        const text = messageText(message);
        if (text) return text;
      }
    }
    for (const message of messages) {
      const text = messageText(message);
      if (text) return text;
    }
    return null;
  }
}

function classifyStatus(status: unknown): "succeeded" | "failed" | "canceled" | null {
  const value = String(status || "").trim().toLowerCase();
  if (["completed", "succeeded", "idle", "ready"].includes(value)) return "succeeded";
  if (["failed", "error", "errored"].includes(value)) return "failed";
  if (["canceled", "cancelled"].includes(value)) return "canceled";
  return null;
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
