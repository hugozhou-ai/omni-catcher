import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const LOG_PREFIX = "[omni-catcher] data-migrate";

export function scoreDataDir(dir: string): number {
  if (!existsSync(dir)) return 0;
  const indexPath = join(dir, "index.jsonl");
  if (existsSync(indexPath)) {
    const lines = readFileSync(indexPath, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean).length;
    if (lines > 0) return lines * 1000;
  }
  let files = 0;
  for (const folder of ["inbox", "notes", "bookmarks", "todos"]) {
    const folderPath = join(dir, folder);
    if (!existsSync(folderPath)) continue;
    files += readdirSync(folderPath).filter((name) => !name.startsWith(".")).length;
  }
  return files;
}

export function listAlternateDataDirs(appId: string, workspaceId: string, currentDataDir: string): string[] {
  const resolvedCurrent = resolve(currentDataDir);
  const candidates: string[] = [];

  if (workspaceId && workspaceId !== "dev") {
    candidates.push(resolve(homedir(), ".tutti/apps/workspaces", workspaceId, appId, "data"));
  }

  const installationsRoot = resolve(homedir(), ".tutti/apps/installations", appId);
  if (existsSync(installationsRoot)) {
    for (const entry of readdirSync(installationsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      candidates.push(resolve(installationsRoot, entry.name, "data"));
    }
  }

  const stableBackup = resolve(installationsRoot, ".data-backup");
  if (existsSync(stableBackup)) {
    candidates.push(stableBackup);
  }

  return [...new Set(candidates.map((dir) => resolve(dir)))].filter((dir) => dir !== resolvedCurrent);
}

export function pickRichestDataDir(dirs: string[]): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const dir of dirs) {
    const score = scoreDataDir(dir);
    if (score > bestScore) {
      bestScore = score;
      best = dir;
    }
  }
  return best;
}

export function migrateDataDirIfNeeded(input: {
  appId: string;
  workspaceId: string;
  dataDir: string;
}): boolean {
  const currentScore = scoreDataDir(input.dataDir);
  if (currentScore > 0) return false;

  const source = pickRichestDataDir(listAlternateDataDirs(input.appId, input.workspaceId, input.dataDir));
  if (!source || scoreDataDir(source) <= currentScore) return false;

  cpSync(source, input.dataDir, { recursive: true, force: true });
  console.log(
        LOG_PREFIX +
          " " +
          JSON.stringify({
            action: "restored",
            from: source,
            to: input.dataDir,
            currentScore,
            sourceScore: scoreDataDir(source),
          }),
  );
  return true;
}
