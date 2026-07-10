import { randomUUID } from "node:crypto";

import type { AgentEvent } from "@tutti-os/agent-acp-kit";
import {
  createTuttiAgentAppRuntime,
  type TuttiAgentAppRuntime,
  type TuttiAgentProviderCatalogEntry,
} from "@tutti-os/agent-acp-kit/tutti";
import type { AgentProvider, AgentProvidersResult } from "@omni-catcher/shared";
import { createServiceIdentifier } from "@omni-catcher/shared/platform";

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

export function normalizeProvider(value: unknown): string {
  const provider = String(value || "").trim().toLowerCase();
  // Settings created before Tutti standardized the Claude runtime ID may still
  // contain "claude". Canonicalize only at this persistence/API boundary; the
  // live provider catalog remains the source of truth for executable IDs.
  return provider === "claude" ? "claude-code" : provider;
}

export class AgentService implements IAgentService {
  constructor(
    private readonly agents: TuttiAgentAppRuntime = createTuttiAgentAppRuntime(),
  ) {}

  async listProviders(): Promise<AgentProvidersResult> {
    const catalog = await this.agents.getProviderCatalog({
      includeComposerOptions: false,
    });
    const providers: AgentProvider[] = catalog.providers
      .filter((provider) => provider.available)
      .map((provider) => ({ provider: provider.id, status: "available" }));
    return {
      available: catalog.status === "ready" && providers.length > 0,
      providers,
      defaultProvider:
        catalog.selectedProviderId ?? catalog.defaultProviderId ?? "",
      ...(catalog.errorCode ? { error: catalog.errorCode } : {}),
    };
  }

  async resolveProvider(preferred?: string): Promise<string> {
    const catalog = await this.agents.getProviderCatalog({
      preferredProviderId: normalizeProvider(preferred),
      includeComposerOptions: false,
    });
    return catalog.selectedProviderId ?? normalizeProvider(preferred);
  }

  async resolveModel(provider: string): Promise<string> {
    const entry = await this.resolveProviderEntry(provider);
    return entry?.defaultModelId ?? entry?.models[0]?.id ?? "";
  }

  async runPrompt(
    prompt: string,
    title: string,
    timeoutMs: number,
    preferred?: string,
    callbacks?: AgentRunCallbacks,
  ): Promise<AgentRunResult> {
    if (await callbacks?.isCanceled?.()) {
      throw new Error("agent session was canceled");
    }

    const catalog = await this.agents.getProviderCatalog({
      preferredProviderId: normalizeProvider(preferred),
      composer: { cwd: agentCwd() },
    });
    const provider = catalog.selectedProviderId;
    if (!provider) throw new Error("no agent provider is available");
    const providerEntry = catalog.providers.find((entry) => entry.id === provider);
    const model = providerEntry?.defaultModelId ?? providerEntry?.models[0]?.id;
    if (!model) throw new Error(`no model available for provider ${provider}`);

    const runId = randomUUID();
    await callbacks?.onStarted?.(runId, provider);
    const output: string[] = [];

    for await (const event of this.agents.run({
      providerId: provider,
      runId,
      localCwd: agentCwd(),
      prompt,
      model,
      timeoutMs,
      metadata: { title },
    })) {
      if (await callbacks?.isCanceled?.()) {
        await this.agents.cancel(runId);
        throw new Error("agent session was canceled");
      }
      if (event.type === "text_delta") output.push(event.text);
      const activity = activityFromAgentEvent(event);
      if (activity) await callbacks?.onActivity?.(activity);
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "done") {
        if (event.status === "canceled") {
          throw new Error("agent session was canceled");
        }
        if (event.status === "failed") {
          throw new Error("agent session failed");
        }
      }
    }

    const text = output.join("").trim();
    if (!text) throw new Error("agent completed without producing a result");
    return { text, sessionId: runId, provider };
  }

  async cancelSession(sessionId: string): Promise<void> {
    const runId = sessionId.trim();
    if (runId) await this.agents.cancel(runId);
  }

  private async resolveProviderEntry(
    provider: string,
  ): Promise<TuttiAgentProviderCatalogEntry | undefined> {
    const normalized = normalizeProvider(provider);
    const catalog = await this.agents.getProviderCatalog({
      preferredProviderId: normalized,
      composer: { cwd: agentCwd() },
    });
    return catalog.providers.find((entry) => entry.id === normalized);
  }
}

function agentCwd() {
  return process.env.TUTTI_APP_DATA_DIR?.trim() || process.cwd();
}

function activityFromAgentEvent(event: AgentEvent): string | null {
  if (event.type === "thinking" || event.type === "thinking_delta") {
    return truncateActivity(event.text);
  }
  if (event.type === "status") {
    return event.message?.trim() || event.status?.trim() || event.stage?.trim() || null;
  }
  if (event.type === "tool_call") {
    return `Using ${event.name || "tool"}…`;
  }
  return null;
}

function truncateActivity(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= 240 ? compact : `${compact.slice(0, 237)}...`;
}
