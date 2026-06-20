#!/usr/bin/env node
/**
 * Build the web + server, then assemble a self-contained Tutti app package at
 * build/tutti-app/package: web assets in dist/, a bundled server in server/,
 * and the manifest/CLI/bootstrap/prompts/locales/docs the runtime needs.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, chmodSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = resolve(root, "build/tutti-app");
const pkg = resolve(outRoot, "package");

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

function copy(relative) {
  const from = resolve(root, relative);
  if (!existsSync(from)) throw new Error(`missing required input: ${relative}`);
  cpSync(from, resolve(pkg, relative), { recursive: true, dereference: true });
}

console.log("• cleaning output");
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(resolve(pkg, "server"), { recursive: true });

console.log("• building @omni-catcher/shared");
run("pnpm", ["--filter", "@omni-catcher/shared", "build"]);

console.log("• building web (vite)");
run("pnpm", ["--filter", "@omni-catcher/web", "build"]);

console.log("• bundling server (esbuild)");
await build({
  entryPoints: [resolve(root, "apps/server/src/server.ts")],
  outfile: resolve(pkg, "server/server.js"),
  platform: "node",
  format: "esm",
  target: "node20",
  bundle: true,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

console.log("• assembling package");
cpSync(resolve(root, "apps/web/dist"), resolve(pkg, "dist"), { recursive: true });
for (const input of ["tutti.app.json", "tutti.cli.json", "icon.png", "AGENTS.md", "COMMANDS.md", "prompts", "locales"]) {
  copy(input);
}
cpSync(resolve(root, "bootstrap.sh"), resolve(pkg, "bootstrap.sh"));
chmodSync(resolve(pkg, "bootstrap.sh"), 0o755);

console.log(`✓ package ready at ${pkg}`);
