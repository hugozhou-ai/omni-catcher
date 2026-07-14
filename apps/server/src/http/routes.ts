import type { FastifyInstance } from "fastify";
import { ILogService, type IInstantiationService } from "@omni-catcher/shared/platform";
import {
  cliJson,
  cliTable,
  type CliInvokeEnvelope,
  type ConfirmEdits,
  type TodoProgress,
} from "@omni-catcher/shared";
import { IAppConfig } from "../config.js";
import { IStorageService } from "../services/storageService.js";
import {
  IAgentService,
  normalizeAgentTargetId,
  normalizeLegacyProvider,
} from "../services/agentService.js";
import { ICaptureService } from "../services/captureService.js";
import { IReferenceService } from "../services/referenceService.js";

function cliInput(body: unknown): Record<string, unknown> {
  const envelope = (body || {}) as CliInvokeEnvelope;
  return (envelope.input as Record<string, unknown>) || {};
}

export function projectSettingsResponse(
  settings: Record<string, unknown>,
  agentTargetId: string,
  agentProvider?: string,
): Record<string, unknown> {
  const response: Record<string, unknown> = { ...settings, agentTargetId };
  delete response.agentProvider;
  return { ...response, ...(agentProvider ? { agentProvider } : {}) };
}

export function registerRoutes(app: FastifyInstance, services: IInstantiationService): void {
  const config = services.get(IAppConfig);
  const storage = services.get(IStorageService);
  const agent = services.get(IAgentService);
  const captures = services.get(ICaptureService);
  const references = services.get(IReferenceService);
  const log = services.get(ILogService);

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/api/context", async () => ({
    workspaceId: config.workspaceId,
    workspaceName: config.workspaceName,
    workspaceRoot: config.workspaceRoot,
    dataDir: config.dataDir,
  }));

  app.get("/api/agent-targets", async () => agent.listAgentTargets());

  /** @deprecated Compatibility endpoint. Shared providers are omitted. */
  app.get("/api/agent-providers", async () => agent.listProviders());

  app.get("/api/settings", async () => {
    let settings = await storage.readSettings();
    const resolvedTargetId = await agent.resolveConfiguredAgentTarget(settings);
    const legacyProvider = normalizeLegacyProvider(settings.agentProvider);
    if (!normalizeAgentTargetId(settings.agentTargetId) && legacyProvider && resolvedTargetId) {
      settings = await storage.updateSettings((current) => {
        if (
          normalizeAgentTargetId(current.agentTargetId) ||
          normalizeLegacyProvider(current.agentProvider) !== legacyProvider
        ) {
          return current;
        }
        const migrated: Record<string, unknown> = { ...current, agentTargetId: resolvedTargetId };
        delete migrated.agentProvider;
        return migrated;
      });
    }
    const agentTargetId = normalizeAgentTargetId(settings.agentTargetId);
    const agentProvider = agentTargetId
      ? await agent.projectLegacyProvider(agentTargetId)
      : undefined;
    return projectSettingsResponse(settings, agentTargetId, agentProvider);
  });

  app.post("/api/settings", async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>;
    let agentTargetUpdate: string | undefined;
    try {
      if ("agentTargetId" in body && "agentProvider" in body) {
        throw new Error("Provide agentTargetId or deprecated agentProvider, not both");
      }
      if ("agentTargetId" in body) {
        const requested = normalizeAgentTargetId(body.agentTargetId);
        agentTargetUpdate = requested ? await agent.resolveAgentTarget(requested) : "";
      } else if ("agentProvider" in body) {
        const providerId = normalizeLegacyProvider(body.agentProvider);
        agentTargetUpdate = providerId ? await agent.resolveLegacyProvider(providerId) : "";
      }
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Invalid Agent Target settings",
      });
    }
    const settings = await storage.updateSettings((current) => {
      if (agentTargetUpdate === undefined) return current;
      const next: Record<string, unknown> = { ...current, agentTargetId: agentTargetUpdate };
      delete next.agentProvider;
      return next;
    });
    const agentTargetId = normalizeAgentTargetId(settings.agentTargetId);
    const agentProvider = agentTargetId
      ? await agent.projectLegacyProvider(agentTargetId)
      : undefined;
    return projectSettingsResponse(settings, agentTargetId, agentProvider);
  });

  app.get("/api/captures", async () => ({ captures: await captures.list() }));

  app.get<{ Params: { id: string } }>("/api/captures/:id", async (request, reply) => {
    const capture = await captures.read(request.params.id);
    if (!capture) return reply.code(404).send({ error: "not found" });
    return { capture };
  });

  app.post("/api/capture", async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>;
    const capture = await captures.create(
      String(body.content || ""),
      String(body.url || ""),
      (body.source as "paste" | "url" | "cli") || "paste",
    );
    return reply.code(201).send({ capture });
  });

  app.post<{ Params: { id: string } }>("/api/captures/:id/confirm", async (request) => {
    const body = (request.body || {}) as Record<string, unknown>;
    return captures.confirm(
      request.params.id,
      body.intent as string | undefined,
      Boolean(body.writeIssue),
      (body.edits as ConfirmEdits) || {},
    );
  });

  app.post<{ Params: { id: string } }>("/api/captures/:id/cancel", async (request) => {
    return captures.cancel(request.params.id);
  });

  app.post<{ Params: { id: string } }>("/api/captures/:id/retry", async (request, reply) => {
    try {
      const capture = await captures.retry(request.params.id);
      return reply.code(202).send({ capture });
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>("/api/captures/:id/reject", async (request) => {
    const existing = await storage.readCapture(request.params.id);
    await storage.deleteCapture(request.params.id);
    log.info(
      `capture-reject ${JSON.stringify({
        id: request.params.id,
        existed: Boolean(existing),
        status: existing?.status || "",
      })}`,
    );
    return { rejected: true };
  });

  app.get<{ Querystring: { type?: string } }>("/api/items", async (request) => ({
    items: await storage.listItems(request.query.type),
  }));

  app.get<{ Params: { id: string } }>("/api/items/:id", async (request, reply) => {
    const result = await storage.readItem(request.params.id);
    if (!result) return reply.code(404).send({ error: "not found" });
    return result;
  });

  app.patch<{ Params: { id: string } }>("/api/items/:id", async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>;
    const update: { urgency?: 1 | 2 | 3; importance?: 1 | 2 | 3; todoProgress?: TodoProgress } = {};
    const urgency = Number(body.urgency);
    const importance = Number(body.importance);
    const todoProgress = String(body.todoProgress || "").trim();
    if (urgency === 1 || urgency === 2 || urgency === 3) update.urgency = urgency;
    if (importance === 1 || importance === 2 || importance === 3) update.importance = importance;
    if (todoProgress === "todo" || todoProgress === "doing" || todoProgress === "done") {
      update.todoProgress = todoProgress;
    }
    if (
      update.urgency === undefined &&
      update.importance === undefined &&
      update.todoProgress === undefined
    ) {
      return reply.code(400).send({ error: "urgency, importance or todoProgress required" });
    }
    try {
      return { item: await storage.updateItemMeta(request.params.id, update) };
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });

  app.patch<{ Params: { id: string }; Body: { taskIndex?: number; completed?: boolean } }>(
    "/api/items/:id/todo-task",
    async (request, reply) => {
      const body = (request.body || {}) as Record<string, unknown>;
      const taskIndex = Number(body.taskIndex);
      const completed = Boolean(body.completed);
      try {
        return await storage.updateTodoTask(request.params.id, taskIndex, completed);
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: { body?: string; title?: string; tags?: string[] } }>(
    "/api/items/:id/content",
    async (request, reply) => {
      const body = (request.body || {}) as Record<string, unknown>;
      if (body.body === undefined) {
        return reply.code(400).send({ error: "body required" });
      }
      const update: { body: string; title?: string; tags?: string[] } = {
        body: String(body.body),
      };
      if (body.title !== undefined) update.title = String(body.title);
      if (Array.isArray(body.tags)) update.tags = body.tags.map((tag) => String(tag));
      try {
        return await storage.updateItemContent(request.params.id, update);
      } catch (error) {
        const message = (error as Error).message;
        if (message.includes("not editable")) return reply.code(400).send({ error: message });
        return reply.code(404).send({ error: message });
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/api/items/:id", async (request, reply) => {
    try {
      return { item: await storage.deleteItem(request.params.id), deleted: true };
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });

  app.post("/api/rebuild-index", async () => ({ items: await storage.rebuildIndex() }));

  // -- Tutti surfaces ------------------------------------------------------

  app.post("/tutti/references/search", async (request) =>
    references.search((request.body || {}) as Record<string, unknown>),
  );

  app.post("/tutti/references/list", async (request) =>
    references.list((request.body || {}) as Record<string, unknown>),
  );

  app.post<{ Params: { command: string } }>("/tutti/cli/:command", async (request, reply) => {
    const command = request.params.command;
    const input = cliInput(request.body);
    try {
      switch (command) {
        case "capture": {
          const capture = await captures.create(
            String(input.content || ""),
            String(input.url || ""),
            "cli",
          );
          return cliJson({ id: capture.id, status: capture.status });
        }
        case "list": {
          const items = await storage.listItems(input.type as string | undefined);
          return cliTable(
            items.map((item) => ({
              id: item.id,
              type: item.type,
              title: item.title,
              tags: (item.tags || []).join(", "),
              created: item.createdAt,
            })),
          );
        }
        case "get": {
          const id = String(input.id || "").trim();
          if (!id) throw new InvalidInput("id is required");
          const item = await storage.findItem(id);
          if (item) {
            const detail = await storage.readItem(id);
            return cliJson({
              item,
              path: item.path,
              markdownPath: item.path,
              markdown: detail?.markdown || "",
            });
          }
          const capture = await storage.readCapture(id);
          if (capture) {
            const data = capture.classification || capture.rulePreview;
            return cliJson({
              capture,
              agentResult: capture.agentResult || null,
              savePlan: data.savePlan || null,
              mergePreview: data.mergePreview || null,
              relatedItems: data.relatedItems || [],
            });
          }
          throw new InvalidInput(`${id} was not found`);
        }
        case "pending": {
          const list = await storage.listCaptures();
          return cliTable(
            list.map((capture) => {
              const data = capture.classification || capture.rulePreview;
              return {
                id: capture.id,
                status: capture.status,
                purpose: capture.agentResult?.purpose || "",
                intent: capture.agentResult?.intents.join(", ") || data.primaryIntent,
                title: data.title,
                created: capture.createdAt,
              };
            }),
          );
        }
        case "confirm": {
          const id = String(input.id || "").trim();
          if (!id) throw new InvalidInput("id is required");
          return cliJson(await captures.confirm(id, input.intent as string | undefined, false, {}));
        }
        case "search": {
          const query = String(input.query || "").trim();
          if (!query) throw new InvalidInput("query is required");
          const items = await storage.searchItems(query);
          return cliTable(
            items.map((item) => ({ id: item.id, type: item.type, title: item.title, path: item.path })),
          );
        }
        default:
          return reply.code(404).send({ error: { code: "command_not_found", message: "command not found" } });
      }
    } catch (error) {
      if (error instanceof InvalidInput) {
        return reply.code(400).send({ error: { code: "invalid_input", message: error.message } });
      }
      return reply.code(500).send({ error: { code: "handler_failed", message: (error as Error).message } });
    }
  });
}

class InvalidInput extends Error {}
