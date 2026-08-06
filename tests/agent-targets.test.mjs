import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import {
  AgentTargetSelectionError,
  assertAgentRunContextIdentity,
  projectLegacyProviderCatalog,
  projectLegacyProviderForAgentTarget,
  resolveAgentTargetFromCatalog,
} from "../apps/server/dist/services/agentService.js";
import { loadConfiguredAgentSettings } from "../apps/server/dist/services/agentSettingsService.js";
import { projectSettingsResponse, registerRoutes } from "../apps/server/dist/http/routes.js";

const requireFromServer = createRequire(new URL("../apps/server/package.json", import.meta.url));
const Fastify = requireFromServer("fastify");

const available = { status: "available", reasonCode: "", detail: "" };
const unavailable = {
  status: "unavailable",
  reasonCode: "auth_required",
  detail: "Authentication is required.",
};

function catalog(defaultAgentTargetId = "team:codex-one") {
  return {
    schemaVersion: 1,
    source: "tutti-cli",
    cliContract: "agent-id",
    defaultAgentTargetId,
    agents: [
      {
        agentTargetId: "team:codex-one",
        providerId: "codex",
        displayName: "Writer",
        availability: available,
        runtimeSupported: true,
      },
      {
        agentTargetId: "team:codex-two",
        providerId: "codex",
        displayName: "Reviewer",
        availability: unavailable,
        runtimeSupported: true,
      },
      {
        agentTargetId: "local:claude-code",
        providerId: "claude-code",
        displayName: "Claude",
        availability: available,
        runtimeSupported: true,
      },
    ],
  };
}

test("exact Agent Target selection does not collapse agents that share a provider", () => {
  const selected = resolveAgentTargetFromCatalog(catalog(), {
    agentTargetId: "team:codex-one",
  });
  assert.equal(selected.agentTargetId, "team:codex-one");
  assert.equal(selected.providerId, "codex");
});

test("legacy provider compatibility fails closed against the full catalog", () => {
  assert.throws(
    () =>
      resolveAgentTargetFromCatalog(catalog(), {
        legacyProviderId: "codex",
        useDefault: false,
      }),
    /multiple agents use provider codex/,
  );
  assert.equal(
    resolveAgentTargetFromCatalog(catalog(), {
      legacyProviderId: "claude",
      useDefault: false,
    }).agentTargetId,
    "local:claude-code",
  );
});

test("selection validation uses a typed error while catalog failures remain operational", () => {
  assert.throws(
    () => resolveAgentTargetFromCatalog(catalog(), { agentTargetId: "missing" }),
    AgentTargetSelectionError,
  );
});

test("settings route maps only known target validation failures to HTTP 400", async (t) => {
  const validationApp = Fastify();
  t.after(() => validationApp.close());
  registerRoutes(
    validationApp,
    routeServices({
      resolveAgentTarget: async () => {
        throw new AgentTargetSelectionError("agent target is not in the current catalog: missing");
      },
    }),
  );
  const validation = await validationApp.inject({
    method: "POST",
    url: "/api/settings",
    payload: { agentTargetId: "missing" },
  });
  assert.equal(validation.statusCode, 400);

  const operationalApp = Fastify();
  t.after(() => operationalApp.close());
  registerRoutes(
    operationalApp,
    routeServices({
      resolveAgentTarget: async () => {
        throw new Error("catalog transport unavailable");
      },
    }),
  );
  const operational = await operationalApp.inject({
    method: "POST",
    url: "/api/settings",
    payload: { agentTargetId: "team:one" },
  });
  assert.equal(operational.statusCode, 500);
  assert.match(operational.body, /catalog transport unavailable/);
});

test("unavailable exact targets fail instead of silently switching identity", () => {
  assert.throws(
    () =>
      resolveAgentTargetFromCatalog(catalog(), {
        agentTargetId: "team:codex-two",
      }),
    /Authentication is required/,
  );
  assert.equal(
    resolveAgentTargetFromCatalog(catalog(), {
      agentTargetId: "team:codex-two",
      requireRunnable: false,
      useDefault: false,
    }).agentTargetId,
    "team:codex-two",
  );
});

test("a unique legacy provider resolves identity even while its target is unavailable", () => {
  const value = catalog("team:offline");
  value.agents = [
    {
      agentTargetId: "team:offline",
      providerId: "future-runtime",
      displayName: "Offline Agent",
      availability: unavailable,
      runtimeSupported: true,
    },
  ];
  assert.equal(
    resolveAgentTargetFromCatalog(value, {
      legacyProviderId: "future-runtime",
      requireRunnable: false,
      useDefault: false,
    }).agentTargetId,
    "team:offline",
  );
});

test("an unavailable daemon default falls back only when no exact target was requested", () => {
  assert.equal(
    resolveAgentTargetFromCatalog(catalog("team:codex-two"), {}).agentTargetId,
    "team:codex-one",
  );
});

test("legacy provider API omits shared providers and preserves an unambiguous default", () => {
  const projected = projectLegacyProviderCatalog(catalog("local:claude-code"));
  assert.deepEqual(projected.providers, [{ provider: "claude-code", status: "available" }]);
  assert.equal(projected.defaultProvider, "claude-code");
});

test("settings expose a legacy provider only for an unambiguous exact target", () => {
  assert.equal(
    projectLegacyProviderForAgentTarget(catalog(), "team:codex-one"),
    undefined,
  );
  assert.equal(
    projectLegacyProviderForAgentTarget(catalog(), "local:claude-code"),
    "claude-code",
  );
});

test("run preparation fails if target-scoped skills change identity", () => {
  const target = { agentTargetId: "team:codex-one", providerId: "codex" };
  assert.doesNotThrow(() =>
    assertAgentRunContextIdentity(
      target,
      { source: "tutti-cli", ...target },
    ),
  );
  assert.throws(
    () =>
      assertAgentRunContextIdentity(
        target,
        {
          source: "tutti-cli",
          agentTargetId: "team:codex-two",
          providerId: target.providerId,
        },
      ),
    /skills=\{source:tutti-cli,agentTargetId:team:codex-two,providerId:codex\}/,
  );
});

test("legacy settings migration compares the current value before replacing it", async () => {
  let current = { agentProvider: "claude", custom: true };
  const storage = {
    readSettings: async () => current,
    updateSettings: async (update) => {
      current = { agentTargetId: "user:newer-target", custom: true };
      current = update(current);
      return current;
    },
  };
  const result = await loadConfiguredAgentSettings(storage, {
    resolveConfiguredAgentTarget: async (settings) =>
      settings.agentTargetId ||
      (settings.agentProvider === "claude" ? "local:claude-code" : undefined),
  });

  assert.deepEqual(result.settings, { agentTargetId: "user:newer-target", custom: true });
  assert.equal(result.agentTargetId, "user:newer-target");
});

test("legacy settings migration persists an exact target and removes the provider key", async () => {
  let current = { agentProvider: "claude", custom: true };
  const result = await loadConfiguredAgentSettings(
    {
      readSettings: async () => current,
      updateSettings: async (update) => {
        current = update(current);
        return current;
      },
    },
    { resolveConfiguredAgentTarget: async () => "local:claude-code" },
  );

  assert.deepEqual(result.settings, {
    agentTargetId: "local:claude-code",
    custom: true,
  });
});

test("capture migration can continue after a settings write failure", async () => {
  const failures = [];
  const result = await loadConfiguredAgentSettings(
    {
      readSettings: async () => ({ agentProvider: "claude" }),
      updateSettings: async () => {
        throw new Error("disk unavailable");
      },
    },
    { resolveConfiguredAgentTarget: async () => "local:claude-code" },
    (error) => failures.push(error),
  );

  assert.equal(result.agentTargetId, "local:claude-code");
  assert.deepEqual(result.settings, { agentProvider: "claude" });
  assert.match(String(failures[0]), /disk unavailable/);
});

test("settings responses never leak an unvalidated stored legacy provider", () => {
  assert.deepEqual(
    projectSettingsResponse({ agentProvider: "codex", custom: true }, ""),
    { agentTargetId: "", custom: true },
  );
  assert.deepEqual(
    projectSettingsResponse(
      { agentProvider: "claude", custom: true },
      "local:claude-code",
      "claude-code",
    ),
    {
      agentTargetId: "local:claude-code",
      agentProvider: "claude-code",
      custom: true,
    },
  );
});

function routeServices(agentOverrides) {
  const services = {
    appConfig: {
      workspaceId: "workspace-1",
      workspaceName: "Workspace",
      workspaceRoot: "/workspace",
      dataDir: "/data",
    },
    storageService: {
      readSettings: async () => ({}),
      updateSettings: async (update) => update({}),
    },
    agentService: {
      listAgentTargets: async () => ({ available: false, agents: [], defaultAgentTargetId: "" }),
      listProviders: async () => ({ available: false, providers: [], defaultProvider: "" }),
      projectLegacyProvider: async () => undefined,
      ...agentOverrides,
    },
    captureService: {},
    referenceService: {},
    logService: { info() {}, warn() {}, error() {}, debug() {} },
  };
  return {
    get(identifier) {
      return services[identifier.id];
    },
  };
}
