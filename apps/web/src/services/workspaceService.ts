import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import type { AgentTargetsResult, WorkspaceContext } from "@omni-catcher/shared";
import type { IApiService } from "./apiService.js";

export interface IWorkspaceService {
  getContext(): Promise<WorkspaceContext | null>;
  getAgentTargets(): Promise<AgentTargetsResult>;
  getPreferredAgentTarget(): Promise<string>;
  setPreferredAgentTarget(agentTargetId: string): Promise<void>;
}

export const IWorkspaceService = createServiceIdentifier<IWorkspaceService>("workspaceService");

export class WorkspaceService implements IWorkspaceService {
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
      const settings = await this.api.get<Record<string, unknown>>("/api/settings");
      return String(settings.agentTargetId || "");
    } catch {
      return "";
    }
  }

  async setPreferredAgentTarget(agentTargetId: string): Promise<void> {
    await this.api.post("/api/settings", { agentTargetId });
  }
}
