import type { IAgentService } from "./agentService.js";
import { normalizeAgentTargetId, normalizeLegacyProvider } from "./agentService.js";
import type { IStorageService } from "./storageService.js";

export interface ConfiguredAgentSettings {
  settings: Record<string, unknown>;
  agentTargetId: string | undefined;
}

export async function loadConfiguredAgentSettings(
  storage: Pick<IStorageService, "readSettings" | "updateSettings">,
  agent: Pick<IAgentService, "resolveConfiguredAgentTarget">,
  onMigrationError?: (error: unknown) => void,
): Promise<ConfiguredAgentSettings> {
  let settings = await storage.readSettings();
  const agentTargetId = await agent.resolveConfiguredAgentTarget(settings);
  const storedTargetId = normalizeAgentTargetId(settings.agentTargetId);
  const legacyProvider = normalizeLegacyProvider(settings.agentProvider);
  if (storedTargetId || !legacyProvider || !agentTargetId) return { settings, agentTargetId };

  try {
    settings = await storage.updateSettings((current) => {
      if (
        normalizeAgentTargetId(current.agentTargetId) ||
        normalizeLegacyProvider(current.agentProvider) !== legacyProvider
      ) {
        return current;
      }
      const migrated: Record<string, unknown> = { ...current, agentTargetId };
      delete migrated.agentProvider;
      return migrated;
    });
  } catch (error) {
    if (!onMigrationError) throw error;
    onMigrationError(error);
  }
  return { settings, agentTargetId };
}
