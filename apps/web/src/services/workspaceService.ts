import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import type { AgentTargetsResult, WorkspaceContext } from "@omni-catcher/shared";
import type { IApiService } from "./apiService.js";

export interface IWorkspaceService {
  getContext(): Promise<WorkspaceContext | null>;
  getAgentTargets(): Promise<AgentTargetsResult>;
  getPreferredAgentTarget(): Promise<string>;
  setPreferredAgentTarget(agentTargetId: string): Promise<void>;
  subscribePreferredAgentTarget(listener: (agentTargetId: string) => void): () => void;
}

export const IWorkspaceService = createServiceIdentifier<IWorkspaceService>("workspaceService");

export class WorkspaceService implements IWorkspaceService {
  private preferredAgentTargetId = "";
  private confirmedAgentTargetId = "";
  private readonly preferredListeners = new Set<(agentTargetId: string) => void>();
  private preferenceWrite: Promise<void> = Promise.resolve();
  private preferenceVersion = 0;

  constructor(private readonly api: IApiService) {}

  async getContext(): Promise<WorkspaceContext | null> {
    try {
      return await this.api.get<WorkspaceContext>("/api/context");
    } catch {
      return null;
    }
  }

  async getAgentTargets(): Promise<AgentTargetsResult> {
    try {
      return await this.api.get<AgentTargetsResult>("/api/agent-targets");
    } catch {
      return { available: false, agents: [], defaultAgentTargetId: "" };
    }
  }

  async getPreferredAgentTarget(): Promise<string> {
    try {
      await this.waitForPreferenceWrites();
      const readVersion = this.preferenceVersion;
      const settings = await this.api.get<Record<string, unknown>>("/api/settings");
      const agentTargetId = String(settings.agentTargetId || "").trim();
      if (this.preferenceVersion === readVersion) {
        this.confirmedAgentTargetId = agentTargetId;
        this.publishPreferredAgentTarget(agentTargetId);
        return agentTargetId;
      }
      return this.preferredAgentTargetId;
    } catch {
      return this.preferredAgentTargetId;
    }
  }

  async setPreferredAgentTarget(agentTargetId: string): Promise<void> {
    const requested = agentTargetId.trim();
    const writeVersion = ++this.preferenceVersion;
    const write = this.preferenceWrite.then(async () => {
      try {
        await this.api.post("/api/settings", { agentTargetId: requested });
        this.confirmedAgentTargetId = requested;
        if (this.preferenceVersion === writeVersion) {
          this.publishPreferredAgentTarget(requested);
        }
      } catch (error) {
        if (this.preferenceVersion === writeVersion) {
          this.publishPreferredAgentTarget(this.confirmedAgentTargetId);
        }
        throw error;
      }
    });
    this.preferenceWrite = write.catch(() => undefined);
    return write;
  }

  subscribePreferredAgentTarget(listener: (agentTargetId: string) => void): () => void {
    this.preferredListeners.add(listener);
    try {
      listener(this.preferredAgentTargetId);
    } catch {
      // One observer cannot prevent later preference updates from being delivered.
    }
    return () => this.preferredListeners.delete(listener);
  }

  private publishPreferredAgentTarget(agentTargetId: string): void {
    this.preferredAgentTargetId = agentTargetId;
    for (const listener of this.preferredListeners) {
      try {
        listener(agentTargetId);
      } catch {
        // Observers cannot change the persistence result or block later listeners.
      }
    }
  }

  private async waitForPreferenceWrites(): Promise<void> {
    while (true) {
      const observed = this.preferenceWrite;
      await observed;
      if (observed === this.preferenceWrite) return;
    }
  }
}
