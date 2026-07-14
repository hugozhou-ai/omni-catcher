import { randomUUID } from "node:crypto";

import {
  createDefaultLocalAgentRuntime,
  type AgentEvent,
  type LocalAgentRuntime,
} from "@tutti-os/agent-acp-kit";
import {
  loadTuttiAgentCatalog,
  loadTuttiAgentComposerOptions,
  loadTuttiAgentSkillContext,
  type TuttiAgentCatalog,
  type TuttiAgentCatalogEntry,
  type TuttiAgentComposerOptions,
  type TuttiAgentSkillContext,
} from "@tutti-os/agent-acp-kit/tutti";
import type {
  AgentProvidersResult,
  AgentTarget,
  AgentTargetsResult,
} from "@omni-catcher/shared";
import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import type { ISkillRegistryService } from "./skillRegistryService.js";

export interface AgentRunResult {
  text: string;
  sessionId: string;
  agentTargetId: string;
  providerId: string;
}

export interface AgentRunCallbacks {
  isCanceled?(): boolean | Promise<boolean>;
  onStarted?(
    sessionId: string,
    agentTargetId: string,
    providerId: string,
  ): void | Promise<void>;
  onActivity?(activityText: string): void | Promise<void>;
}

export interface IAgentService {
  listAgentTargets(): Promise<AgentTargetsResult>;
  /** @deprecated Compatibility projection. Ambiguous providers are omitted. */
  listProviders(): Promise<AgentProvidersResult>;
  resolveConfiguredAgentTarget(settings: Record<string, unknown>): Promise<string | undefined>;
  resolveAgentTarget(agentTargetId: string): Promise<string>;
  resolveLegacyProvider(providerId: string): Promise<string>;
  projectLegacyProvider(agentTargetId: string): Promise<string | undefined>;
  runPrompt(
    prompt: string,
    title: string,
    timeoutMs: number,
    preferredAgentTargetId?: string,
    callbacks?: AgentRunCallbacks,
  ): Promise<AgentRunResult>;
  cancelSession(sessionId: string): Promise<void>;
}

export const IAgentService = createServiceIdentifier<IAgentService>("agentService");

export class AgentTargetSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTargetSelectionError";
  }
}

/** Normalize only the deprecated provider compatibility input. Agent Target IDs stay exact. */
export function normalizeLegacyProvider(value: unknown): string {
  const provider = String(value || "").trim().toLowerCase();
  return provider === "claude" ? "claude-code" : provider;
}

export function normalizeAgentTargetId(value: unknown): string {
  return String(value || "").trim();
}

export function resolveAgentTargetFromCatalog(
  catalog: TuttiAgentCatalog,
  input: {
    agentTargetId?: string;
    legacyProviderId?: string;
    requireRunnable?: boolean;
    useDefault?: boolean;
  },
): TuttiAgentCatalogEntry {
  const requestedTarget = normalizeAgentTargetId(input.agentTargetId);
  const legacyProviderId = normalizeLegacyProvider(input.legacyProviderId);
  if (requestedTarget && legacyProviderId) {
    throw new AgentTargetSelectionError("Provide agentTargetId or deprecated agentProvider, not both");
  }

  let selected: TuttiAgentCatalogEntry | undefined;
  if (requestedTarget) {
    selected = catalog.agents.find((agent) => agent.agentTargetId === requestedTarget);
    if (!selected) throw new AgentTargetSelectionError(`agent target is not in the current catalog: ${requestedTarget}`);
  } else if (legacyProviderId) {
    const matches = catalog.agents.filter((agent) => agent.providerId === legacyProviderId);
    if (matches.length !== 1) {
      throw new AgentTargetSelectionError(
        matches.length > 1
          ? `multiple agents use provider ${legacyProviderId}; select an exact agent target id`
          : `provider is not in the current agent catalog: ${legacyProviderId}`,
      );
    }
    selected = matches[0];
  } else if (input.useDefault !== false) {
    const defaultAgent = catalog.agents.find(
      (agent) => agent.agentTargetId === catalog.defaultAgentTargetId,
    );
    selected =
      (defaultAgent && isRunnableAgent(defaultAgent) ? defaultAgent : undefined) ??
      catalog.agents.find(isRunnableAgent);
  }

  if (!selected) throw new AgentTargetSelectionError("no agent target is available");
  if (input.requireRunnable !== false && !isRunnableAgent(selected)) {
    throw new AgentTargetSelectionError(
      selected.availability.detail || `agent target is not available: ${selected.agentTargetId}`,
    );
  }
  return selected;
}

export function projectLegacyProviderCatalog(catalog: TuttiAgentCatalog): AgentProvidersResult {
  const counts = new Map<string, number>();
  for (const agent of catalog.agents) {
    counts.set(agent.providerId, (counts.get(agent.providerId) ?? 0) + 1);
  }
  const agents = catalog.agents.filter(
    (agent) => counts.get(agent.providerId) === 1 && isRunnableAgent(agent),
  );
  const defaultAgent = catalog.agents.find(
    (agent) => agent.agentTargetId === catalog.defaultAgentTargetId,
  );
  const defaultProvider =
    defaultAgent && counts.get(defaultAgent.providerId) === 1 && isRunnableAgent(defaultAgent)
      ? defaultAgent.providerId
      : "";
  return {
    available: agents.length > 0,
    providers: agents.map((agent) => ({ provider: agent.providerId, status: "available" })),
    defaultProvider,
  };
}

export function projectLegacyProviderForAgentTarget(
  catalog: TuttiAgentCatalog,
  agentTargetId: string,
): string | undefined {
  const target = catalog.agents.find((agent) => agent.agentTargetId === agentTargetId);
  if (!target) return undefined;
  return catalog.agents.filter((agent) => agent.providerId === target.providerId).length === 1
    ? target.providerId
    : undefined;
}

export function resolveComposerModel(
  composer: Pick<TuttiAgentComposerOptions, "modelConfig">,
): string | undefined {
  return (
    composer.modelConfig.currentValue ||
    composer.modelConfig.defaultValue ||
    composer.modelConfig.options[0]?.value ||
    undefined
  );
}

export function assertAgentRunContextIdentity(
  target: Pick<TuttiAgentCatalogEntry, "agentTargetId" | "providerId">,
  composer: Pick<TuttiAgentComposerOptions, "agentTargetId" | "providerId">,
  skillContext: Pick<
    TuttiAgentSkillContext,
    "source" | "agentTargetId" | "providerId"
  >,
): void {
  const composerMatches =
    composer.agentTargetId === target.agentTargetId && composer.providerId === target.providerId;
  const skillContextMatches =
    skillContext.source === "standalone" ||
    (skillContext.agentTargetId === target.agentTargetId &&
      skillContext.providerId === target.providerId);
  if (!composerMatches || !skillContextMatches) {
    throw new Error(
      `agent target identity changed while preparing the run: ` +
        `catalog={agentTargetId:${target.agentTargetId},providerId:${target.providerId}} ` +
        `composer={agentTargetId:${composer.agentTargetId},providerId:${composer.providerId}} ` +
        `skills={source:${skillContext.source},agentTargetId:${skillContext.agentTargetId},providerId:${skillContext.providerId}}`,
    );
  }
}

export class AgentService implements IAgentService {
  constructor(
    private readonly skills: ISkillRegistryService,
    private readonly cwd: string,
    private readonly runtime: LocalAgentRuntime<string, string> = createDefaultLocalAgentRuntime(),
  ) {}

  async listAgentTargets(): Promise<AgentTargetsResult> {
    const catalog = await this.loadCatalog();
    const agents = catalog.agents.map(toAgentTarget);
    const available = agents.filter(
      (agent) => agent.runtimeSupported && agent.status === "available",
    );
    const defaultAgent = available.find(
      (agent) => agent.agentTargetId === catalog.defaultAgentTargetId,
    );
    return {
      available: available.length > 0,
      agents,
      defaultAgentTargetId: defaultAgent?.agentTargetId ?? available[0]?.agentTargetId ?? "",
    };
  }

  async listProviders(): Promise<AgentProvidersResult> {
    return projectLegacyProviderCatalog(await this.loadCatalog());
  }

  async resolveConfiguredAgentTarget(
    settings: Record<string, unknown>,
  ): Promise<string | undefined> {
    const agentTargetId = normalizeAgentTargetId(settings.agentTargetId);
    const legacyProviderId = agentTargetId
      ? ""
      : normalizeLegacyProvider(settings.agentProvider);
    if (!agentTargetId && !legacyProviderId) return undefined;
    const agent = resolveAgentTargetFromCatalog(await this.loadCatalog(), {
      ...(agentTargetId ? { agentTargetId } : {}),
      ...(legacyProviderId ? { legacyProviderId } : {}),
      requireRunnable: false,
      useDefault: false,
    });
    return agent.agentTargetId;
  }

  async resolveAgentTarget(agentTargetId: string): Promise<string> {
    return resolveAgentTargetFromCatalog(await this.loadCatalog(), {
      agentTargetId,
      requireRunnable: false,
      useDefault: false,
    }).agentTargetId;
  }

  async resolveLegacyProvider(providerId: string): Promise<string> {
    return resolveAgentTargetFromCatalog(await this.loadCatalog(), {
      legacyProviderId: providerId,
      requireRunnable: false,
      useDefault: false,
    }).agentTargetId;
  }

  async projectLegacyProvider(agentTargetId: string): Promise<string | undefined> {
    return projectLegacyProviderForAgentTarget(await this.loadCatalog(), agentTargetId);
  }

  async runPrompt(
    prompt: string,
    title: string,
    timeoutMs: number,
    preferredAgentTargetId?: string,
    callbacks?: AgentRunCallbacks,
  ): Promise<AgentRunResult> {
    if (await callbacks?.isCanceled?.()) throw new Error("agent session was canceled");

    const target = resolveAgentTargetFromCatalog(await this.loadCatalog(), {
      ...(preferredAgentTargetId ? { agentTargetId: preferredAgentTargetId } : {}),
    });
    const runId = randomUUID();
    const [composer, skillContext, appSkills] = await Promise.all([
      loadTuttiAgentComposerOptions({
        runtime: this.runtime,
        agentTargetId: target.agentTargetId,
        cwd: this.cwd,
        env: process.env,
      }),
      loadTuttiAgentSkillContext({
        agentTargetId: target.agentTargetId,
        agentSessionId: runId,
        cwd: this.cwd,
        env: process.env,
      }),
      this.skills.loadAll(),
    ]);
    assertAgentRunContextIdentity(target, composer, skillContext);
    const model = resolveComposerModel(composer);
    const permissionMode = composer.permissionConfig.modes.find(
      (mode) => mode.id === composer.permissionConfig.defaultValue,
    );

    await callbacks?.onStarted?.(runId, target.agentTargetId, target.providerId);
    const output: string[] = [];
    for await (const event of this.runtime.run({
      runId,
      conversationId: runId,
      sessionId: runId,
      provider: target.providerId,
      runtimeKind: "local-agent",
      runtimeProvider: target.providerId,
      cwd: this.cwd,
      prompt,
      systemPrompt: skillContext.recommendedSystemPrompt?.content,
      model,
      reasoning:
        composer.reasoningConfig.currentValue || composer.reasoningConfig.defaultValue || undefined,
      permission: permissionMode
        ? { modeId: permissionMode.id, semantic: permissionMode.semantic }
        : undefined,
      timeoutMs,
      skillManifest: [...skillContext.skillManifest, ...appSkills],
      metadata: { title, agentTargetId: target.agentTargetId, providerId: target.providerId },
      // Captures are independent tasks. Never resume a provider session across Agent Targets.
      resume: { mode: "fresh" },
    })) {
      if (await callbacks?.isCanceled?.()) {
        await this.runtime.cancel(runId);
        throw new Error("agent session was canceled");
      }
      if (event.type === "text_delta") output.push(event.text);
      const activity = activityFromAgentEvent(event);
      if (activity) await callbacks?.onActivity?.(activity);
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "done") {
        if (event.status === "canceled") throw new Error("agent session was canceled");
        if (event.status === "failed") throw new Error("agent session failed");
      }
    }

    const text = output.join("").trim();
    if (!text) throw new Error("agent completed without producing a result");
    return {
      text,
      sessionId: runId,
      agentTargetId: target.agentTargetId,
      providerId: target.providerId,
    };
  }

  async cancelSession(sessionId: string): Promise<void> {
    const runId = sessionId.trim();
    if (runId) await this.runtime.cancel(runId);
  }

  private async loadCatalog(): Promise<TuttiAgentCatalog> {
    return loadTuttiAgentCatalog({ runtime: this.runtime, cwd: this.cwd, env: process.env });
  }
}

function isRunnableAgent(agent: TuttiAgentCatalogEntry): boolean {
  return agent.runtimeSupported && agent.availability.status === "available";
}

function toAgentTarget(agent: TuttiAgentCatalogEntry): AgentTarget {
  return {
    agentTargetId: agent.agentTargetId,
    providerId: agent.providerId,
    displayName: agent.displayName,
    status: agent.availability.status,
    runtimeSupported: agent.runtimeSupported,
  };
}

function activityFromAgentEvent(event: AgentEvent): string | null {
  if (event.type === "thinking" || event.type === "thinking_delta") {
    return truncateActivity(event.text);
  }
  if (event.type === "status") {
    return event.message?.trim() || event.status?.trim() || event.stage?.trim() || null;
  }
  if (event.type === "tool_call") return `Using ${event.name || "tool"}…`;
  return null;
}

function truncateActivity(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= 240 ? compact : `${compact.slice(0, 237)}...`;
}
