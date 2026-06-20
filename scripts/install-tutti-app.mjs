#!/usr/bin/env node
/**
 * Install (or reinstall) the packaged app into the running Tutti desktop daemon
 * for local debugging, then launch it. Drives the daemon REST API directly:
 *   uninstall (best effort) -> import zip -> install -> launch
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
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

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
console.log(`• target workspace ${workspaceId}`);

try {
  await api("POST", `${appsBase}/${appId}/uninstall`);
  console.log("• uninstalled previous build");
} catch {
  // App may not be installed yet — that is fine.
}
await api("POST", `${appsBase}/import`, { archivePath: zipPath });
console.log(`• imported ${appId} v${version}`);
await api("POST", `${appsBase}/${appId}/install`);
const launched = await api("POST", `${appsBase}/${appId}/launch`);
const app = launched.app || launched;

const stateRoot = resolve(homedir(), ".tutti/apps/workspaces", workspaceId, appId);
console.log(`✓ installed & launched ${appId} v${app.version} (status=${app.status})`);
console.log(`  launchUrl : ${app.launchUrl || "(starting)"}`);
console.log(`  data dir  : ${resolve(stateRoot, "data")}`);
console.log(`  logs      : ${resolve(stateRoot, "logs")}/{runtime,web}.log`);
console.log(`  CLI       : TUTTI_WORKSPACE_ID=${workspaceId} tutti --json ${appId} pending`);
