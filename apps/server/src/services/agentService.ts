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

  async runPrompt(prompt: string, title: string, timeoutMs: number): Promise<AgentRunResult> {
    let provider = await this.resolveProvider();
    const start = await this.cli.run(
      ["agent", "start", "--provider", provider, "--cwd", process.env.TUTTI_APP_DATA_DIR || process.cwd(),
        "--title", title, "--prompt", prompt, "--visible"],
      60_000,
    );
    const session = (start.session as Record<string, unknown>) || {};
    const sessionId = String(session.id || "").trim();
    if (!sessionId) throw new Error("agent session was not created");
    provider = normalizeProvider(session.provider) || provider;

    const deadline = Date.now() + timeoutMs;
    let status: string | null = null;
    while (Date.now() < deadline) {
      const info = await this.cli.run(["agent", "get", "--session-id", sessionId], 30_000);
      status = terminalStatus((info.session as Record<string, unknown>)?.status);
      if (status) break;
      await delay(2000);
    }
    if (status === null) throw new Error("agent timed out before producing a result");
    if (status !== "succeeded") throw new Error(`agent session ended with status: ${status}`);

    const text = await this.latestSummary(sessionId);
    if (!text) throw new Error("agent produced no output");
    return { text, sessionId, provider };
  }

  private async latestSummary(sessionId: string): Promise<string | null> {
    const result = await this.cli.run(
      ["agent", "session", "messages", "--session-id", sessionId, "--limit", "80"],
      30_000,
    );
    const messages = ((result.messages as unknown[]) || []).filter(
      (m): m is Record<string, unknown> => Boolean(m) && typeof m === "object",
    );
    messages.sort(
      (a, b) => Number(b.version || b.id || 0) - Number(a.version || a.id || 0),
    );
    for (const message of messages) {
      const role = String(message.role || "").trim().toLowerCase();
      if (role === "assistant" || role === "agent") {
        const text = extractMessageText(message.payload);
        if (text) return text;
      }
    }
    for (const message of messages) {
      const text = extractMessageText(message.payload);
      if (text) return text;
    }
    return null;
  }
}

function terminalStatus(status: unknown): string | null {
  const value = String(status || "").trim().toLowerCase();
  if (["completed", "created", "idle", "ready"].includes(value)) return "succeeded";
  if (value === "failed" || value === "waiting_approval") return "failed";
  if (value === "canceled" || value === "cancelled") return "canceled";
  return null;
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
