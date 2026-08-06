import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { TuttiCliService } from "../apps/server/dist/services/tuttiCliService.js";
import { createNativeCliFixture } from "./helpers/native-cli-fixture.mjs";

test("TUTTI_CLI executes a native path containing spaces without a shell", async () => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "omni catcher tutti cli "));
  const argsPath = path.join(fixtureDir, "args.txt");
  const command = createNativeCliFixture(fixtureDir);
  if (process.platform === "win32") {
    assert.equal(path.basename(command).toLowerCase(), "tutti.exe");
    assert.ok(path.dirname(command).includes(" "));
  }
  const previousCli = process.env.TUTTI_CLI;
  const previousArgsPath = process.env.TUTTI_TEST_ARGS_PATH;
  const previousPayload = process.env.TUTTI_TEST_PAYLOAD;
  process.env.TUTTI_CLI = command;
  process.env.TUTTI_TEST_ARGS_PATH = argsPath;
  process.env.TUTTI_TEST_PAYLOAD = JSON.stringify({ ok: true });
  try {
    const service = new TuttiCliService({ warn() {} });
    await assert.doesNotReject(() => service.run(["issue", "topic", "list"]));
    assert.deepEqual(readFileSync(argsPath, "utf8").split("\n"), [
      "--json",
      "issue",
      "topic",
      "list",
    ]);
  } finally {
    restoreEnv("TUTTI_CLI", previousCli);
    restoreEnv("TUTTI_TEST_ARGS_PATH", previousArgsPath);
    restoreEnv("TUTTI_TEST_PAYLOAD", previousPayload);
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
