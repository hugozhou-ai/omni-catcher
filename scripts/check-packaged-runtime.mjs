import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNativeCliFixture } from "../tests/helpers/native-cli-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(root, "build", "tutti-app", "package");
const runtimeRoot = mkdtempSync(path.join(tmpdir(), "omni catcher runtime "));
const cliArgsPath = path.join(runtimeRoot, "tutti-args.txt");
const cliPath = createNativeCliFixture(runtimeRoot);
if (process.platform === "win32") {
  assert.equal(path.basename(cliPath).toLowerCase(), "tutti.exe");
  assert.ok(path.dirname(cliPath).includes(" "));
}
const port = await availablePort();
const child = spawn(process.execPath, [path.join(packageDir, "server", "server.js")], {
  cwd: packageDir,
  env: {
    ...process.env,
    TUTTI_APP_HOST: "127.0.0.1",
    TUTTI_APP_PORT: String(port),
    TUTTI_APP_PACKAGE_DIR: packageDir,
    TUTTI_APP_DATA_DIR: path.join(runtimeRoot, "data"),
    TUTTI_APP_RUNTIME_DIR: path.join(runtimeRoot, "runtime"),
    TUTTI_APP_LOG_DIR: path.join(runtimeRoot, "logs"),
    TUTTI_CLI: cliPath,
    TUTTI_TEST_ARGS_PATH: cliArgsPath,
    TUTTI_TEST_PAYLOAD: JSON.stringify({
      schemaVersion: 1,
      defaultAgentTargetId: "fixture:codex",
      agents: [
        {
          id: "fixture:codex",
          name: "Fixture Codex",
          provider: "codex",
          availability: { status: "available", reasonCode: "", detail: "" },
        },
      ],
    }),
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

try {
  const response = await waitForHealth(`http://127.0.0.1:${port}/healthz`, child);
  assert.deepEqual(await response.json(), { ok: true });
  const catalogResponse = await fetch(`http://127.0.0.1:${port}/api/agent-targets`);
  assert.equal(catalogResponse.ok, true);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.defaultAgentTargetId, "fixture:codex");
  assert.equal(catalog.agents[0]?.agentTargetId, "fixture:codex");
  const cliArgs = readFileSync(cliArgsPath, "utf8").split("\n");
  assert.ok(cliArgs.includes("agent"));
  assert.ok(cliArgs.includes("list"));
  assert.ok(cliArgs.includes("--json"));
  console.log("packaged Omni Catcher runtime check passed");
} finally {
  child.kill();
  if (child.exitCode === null) {
    await new Promise((resolve) => child.once("close", resolve));
  }
  rmSync(runtimeRoot, { recursive: true, force: true });
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(url, processHandle) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (processHandle.exitCode !== null) {
      throw new Error(`packaged server exited with code ${processHandle.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("packaged server did not become healthy");
}
