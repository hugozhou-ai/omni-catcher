#!/usr/bin/env node
/**
 * Install (or reinstall) the packaged app into the running Tutti desktop daemon
 * for local debugging, then launch it. Drives the daemon REST API directly:
 *   backup data -> import zip -> install -> restore -> launch -> verify/restore
 *
 * Usage:
 *   node scripts/install-tutti-app.mjs [--workspace <id>] [--bump] [--no-package]
 *
 *   --workspace <id>  Target workspace id (default: $TUTTI_WORKSPACE_ID, else the
 *                     daemon's most recently opened workspace).
 *   --bump            Bump the patch version in tutti.app.json before packaging.
 *                     REQUIRED to pick up changes when reinstalling: the daemon
 *                     keys packages by version and will NOT overwrite an existing
 *                     version with new contents.
 *   --no-package      Skip `pnpm package:tutti` and reuse build/tutti-app/package.
 *   --clean-install   Uninstall the app before importing. This can wipe Tutti-owned
 *                     installation state; only use when a normal upgrade fails.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = resolve(root, "build/tutti-app/package");
const zipPath = resolve(root, "build/tutti-app/omni-catcher.zip");
const manifestPath = resolve(root, "tutti.app.json");

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function legacyDataDir(workspaceId, appId) {
  return resolve(homedir(), ".tutti/apps/workspaces", workspaceId, appId, "data");
}

function stableBackupDir(appId) {
  return resolve(homedir(), ".tutti/apps/installations", appId, ".data-backup");
}

function installationDataDirs(appId) {
  const rootDir = resolve(homedir(), ".tutti/apps/installations", appId);
  if (!existsSync(rootDir)) return [];
  return readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => resolve(rootDir, entry.name, "data"));
}

function dataDirScore(dir) {
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

function pickRichestDataDir(dirs) {
  let best = null;
  let bestScore = 0;
  for (const dir of dirs) {
    const score = dataDirScore(dir);
    if (score > bestScore) {
      bestScore = score;
      best = dir;
    }
  }
  return best;
}

function listCandidateDataDirs(workspaceId, appId) {
  return [
    ...new Set([...installationDataDirs(appId), legacyDataDir(workspaceId, appId)]),
  ];
}

function restoreDataDir(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  rmSync(targetDir, { recursive: true, force: true });
  cpSync(sourceDir, targetDir, { recursive: true });
}

function persistStableBackup(appId, sourceDir) {
  if (!sourceDir || dataDirScore(sourceDir) === 0) return;
  const target = stableBackupDir(appId);
  if (resolve(sourceDir) === resolve(target)) return;
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  cpSync(sourceDir, target, { recursive: true });
  console.log(`• persisted stable backup -> ${target}`);
}

function restoreBackupToInstallations(appId, backupDir) {
  if (!existsSync(backupDir) || dataDirScore(backupDir) === 0) return 0;
  const targets = installationDataDirs(appId);
  for (const targetDataDir of targets) {
    restoreDataDir(backupDir, targetDataDir);
    console.log(`• restored app data -> ${targetDataDir}`);
  }
  return targets.length;
}

function parseLaunchPort(launchUrl) {
  if (!launchUrl) return null;
  try {
    return new URL(launchUrl).port || null;
  } catch {
    return null;
  }
}

async function waitForHealthy(port, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return true;
    } catch {
      // Server still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  return false;
}

async function countItems(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/items`);
    if (!response.ok) return 0;
    const data = await response.json();
    return Array.isArray(data.items) ? data.items.length : 0;
  } catch {
    return 0;
  }
}

if (has("--bump")) {
  const manifest = readJson(manifestPath);
  const parts = String(manifest.version || "0.0.0").split(".");
  parts[2] = String((Number(parts[2]) || 0) + 1);
  manifest.version = parts.join(".");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`• bumped version -> ${manifest.version}`);
}

if (!has("--no-package")) {
  console.log("• packaging (pnpm package:tutti)");
  execFileSync("pnpm", ["package:tutti"], { cwd: root, stdio: "inherit" });
}
if (!existsSync(pkgDir)) throw new Error(`package not found at ${pkgDir}; run without --no-package`);

console.log("• zipping package (preserving exec bits)");
rmSync(zipPath, { force: true });
execFileSync("zip", ["-r", "-X", "-q", zipPath, "."], { cwd: pkgDir, stdio: "inherit" });

const listenerPath = resolve(homedir(), ".tutti/run/tuttid.listener.json");
if (!existsSync(listenerPath)) {
  throw new Error("Tutti daemon endpoint not found; start the Tutti desktop app first.");
}
const listener = readJson(listenerPath);
const base = `http://${listener.addr}`;
const token = listener.auth.token;
const appId = readJson(resolve(pkgDir, "tutti.app.json")).appId;
const version = readJson(resolve(pkgDir, "tutti.app.json")).version;

async function api(method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data?.error?.developerMessage || data?.error?.reason || response.statusText;
    throw new Error(`${method} ${path} -> ${response.status}: ${message}`);
  }
  return data;
}

let workspaceId = valueOf("--workspace") || process.env.TUTTI_WORKSPACE_ID;
if (!workspaceId) {
  const startup = await api("GET", "/v1/workspaces/startup");
  workspaceId = startup?.workspace?.id;
}
if (!workspaceId) throw new Error("could not resolve a target workspace id");

const appsBase = `/v1/workspaces/${workspaceId}/apps`;
const dataBackupRoot = mkdtempSync(resolve(tmpdir(), "omni-catcher-data-"));
const dataBackupDir = resolve(dataBackupRoot, "data");
const sourceDataDir = pickRichestDataDir(listCandidateDataDirs(workspaceId, appId));

console.log(`• target workspace ${workspaceId}`);
if (sourceDataDir) {
  cpSync(sourceDataDir, dataBackupDir, { recursive: true });
  persistStableBackup(appId, sourceDataDir);
  console.log(`• backed up app data from ${sourceDataDir}`);
  console.log(`• backup snapshot -> ${dataBackupDir}`);
} else {
  console.log("• no existing app data found to back up");
}

if (has("--clean-install")) {
  try {
    await api("POST", `${appsBase}/${appId}/uninstall`);
    console.log("• uninstalled previous build (--clean-install)");
  } catch {
    console.log("• uninstall skipped (app may not be installed yet)");
  }
} else {
  console.log("• skipping uninstall (use --clean-install only when upgrade fails)");
}

await api("POST", `${appsBase}/import`, { archivePath: zipPath });
console.log(`• imported ${appId} v${version}`);
await api("POST", `${appsBase}/${appId}/install`);
console.log(`• installed ${appId} v${version}`);
restoreBackupToInstallations(appId, dataBackupDir);

let launched;
for (let attempt = 0; attempt < 5; attempt++) {
  try {
    launched = await api("POST", `${appsBase}/${appId}/launch`);
    break;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("404") || attempt === 4) throw error;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * (attempt + 1)));
  }
}
const app = launched.app || launched;
const launchPort = parseLaunchPort(app.launchUrl);

if (launchPort) {
  const healthy = await waitForHealthy(launchPort);
  if (!healthy) {
    console.log(`• warning: server on port ${launchPort} did not become healthy in time`);
  } else {
    let itemCount = await countItems(launchPort);
    if (itemCount === 0 && existsSync(dataBackupDir) && dataDirScore(dataBackupDir) > 0) {
      console.log("• library still empty after launch; restoring again post-start");
      restoreBackupToInstallations(appId, dataBackupDir);
      itemCount = await countItems(launchPort);
    }
    console.log(`• verified library items via API: ${itemCount}`);
  }
}

const activeDataDirs = installationDataDirs(appId);
const activeDataDir = activeDataDirs[0];
const installationRoot = activeDataDir ? resolve(activeDataDir, "..") : "(unknown)";

console.log(`✓ installed & launched ${appId} v${app.version} (status=${app.status})`);
console.log(`  launchUrl : ${app.launchUrl || "(starting)"}`);
console.log(`  data dir  : ${activeDataDir || "(unknown)"}`);
console.log(`  backup    : ${stableBackupDir(appId)}`);
console.log(`  logs      : ${installationRoot}/logs/{runtime,web}.log`);
console.log(`  CLI       : TUTTI_WORKSPACE_ID=${workspaceId} tutti --json ${appId} pending`);
