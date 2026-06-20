import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import type { AgentProvidersResult, WorkspaceContext } from "@omni-catcher/shared";
import type { IApiService } from "./apiService.js";

export interface IWorkspaceService {
  getContext(): Promise<WorkspaceContext | null>;
  getProviders(): Promise<AgentProvidersResult>;
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

  async getProviders(): Promise<AgentProvidersResult> {
    try {
      return await this.api.get<AgentProvidersResult>("/api/agent-providers");
    } catch {
      return { available: false, providers: [], defaultProvider: "" };
    }
  }
}
