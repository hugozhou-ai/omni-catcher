import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAgentRunContextIdentity,
  projectLegacyProviderCatalog,
  projectLegacyProviderForAgentTarget,
  resolveAgentTargetFromCatalog,
  resolveComposerModel,
} from "../apps/server/dist/services/agentService.js";
import { projectSettingsResponse } from "../apps/server/dist/http/routes.js";

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

test("composer model aliases reach the kit runtime without consumer-side prefix stripping", () => {
  assert.equal(
    resolveComposerModel({
      modelConfig: {
        currentValue: "codex:gpt-5-mini",
        defaultValue: "codex:gpt-5",
        options: [],
      },
    }),
    "codex:gpt-5-mini",
  );
});

test("an empty composer model lets the selected runtime use its own default", () => {
  assert.equal(
    resolveComposerModel({
      modelConfig: { currentValue: "", defaultValue: "", options: [] },
    }),
    undefined,
  );
});

test("run preparation fails if target-scoped composer or skills change identity", () => {
  const target = { agentTargetId: "team:codex-one", providerId: "codex" };
  assert.doesNotThrow(() =>
    assertAgentRunContextIdentity(
      target,
      target,
      { source: "tutti-cli", ...target },
    ),
  );
  assert.throws(
    () =>
      assertAgentRunContextIdentity(
        target,
        { agentTargetId: target.agentTargetId, providerId: "future-runtime" },
        { source: "tutti-cli", ...target },
      ),
    /identity changed/,
  );
  assert.throws(
    () =>
      assertAgentRunContextIdentity(
        target,
        target,
        {
          source: "tutti-cli",
          agentTargetId: "team:codex-two",
          providerId: target.providerId,
        },
      ),
    /identity changed/,
  );
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
