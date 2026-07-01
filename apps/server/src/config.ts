import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createServiceIdentifier } from "@omni-catcher/shared/platform";

export interface AppConfig {
  host: string;
  port: number;
  appId: string;
  packageDir: string;
  dataDir: string;
  logDir: string;
  promptsDir: string;
  webDist: string;
  workspaceId: string;
  workspaceName: string;
  workspaceRoot: string;
  classifyTimeoutMs: number;
}

export const IAppConfig = createServiceIdentifier<AppConfig>("appConfig");

const DEFAULT_CLASSIFY_TIMEOUT_MS = 180_000;

export function loadConfig(): AppConfig {
  const serverDir = dirname(fileURLToPath(import.meta.url));
  // Packaged layout: <package>/server/server.js -> packageDir is <package>.
  const packageDir = process.env.TUTTI_APP_PACKAGE_DIR
    ? resolve(process.env.TUTTI_APP_PACKAGE_DIR)
    : resolve(serverDir, "..");
  const dataDir = process.env.TUTTI_APP_DATA_DIR
    ? resolve(process.env.TUTTI_APP_DATA_DIR)
    : resolve(packageDir, ".data");
  return {
    host: process.env.TUTTI_APP_HOST || "127.0.0.1",
    port: Number(process.env.TUTTI_APP_PORT || 3001),
    appId: process.env.TUTTI_APP_ID || "omni-catcher",
    packageDir,
    dataDir,
    logDir: process.env.TUTTI_APP_LOG_DIR ? resolve(process.env.TUTTI_APP_LOG_DIR) : resolve(dataDir, "logs"),
    promptsDir: process.env.OMNI_PROMPTS_DIR
      ? resolve(process.env.OMNI_PROMPTS_DIR)
      : resolve(packageDir, "prompts"),
    webDist: process.env.OMNI_WEB_DIST ? resolve(process.env.OMNI_WEB_DIST) : resolve(packageDir, "dist"),
    workspaceId: process.env.TUTTI_WORKSPACE_ID || "dev",
    workspaceName: process.env.TUTTI_WORKSPACE_NAME || process.env.TUTTI_WORKSPACE_ID || "Dev",
    workspaceRoot: (process.env.TUTTI_WORKSPACE_ROOT || "").trim(),
    classifyTimeoutMs: Number(process.env.OMNI_CLASSIFY_TIMEOUT_MS || DEFAULT_CLASSIFY_TIMEOUT_MS),
  };
}
