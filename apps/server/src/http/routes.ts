import type { FastifyInstance } from "fastify";
import { ILogService, type IInstantiationService } from "@omni-catcher/shared/platform";
import {
  cliJson,
  cliTable,
  type CliInvokeEnvelope,
  type ConfirmEdits,
} from "@omni-catcher/shared";
import { IAppConfig } from "../config.js";
import { IStorageService } from "../services/storageService.js";
import { IAgentService, normalizeProvider } from "../services/agentService.js";
import { ICaptureService } from "../services/captureService.js";
import { IReferenceService } from "../services/referenceService.js";

function cliInput(body: unknown): Record<string, unknown> {
  const envelope = (body || {}) as CliInvokeEnvelope;
  return (envelope.input as Record<string, unknown>) || {};
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

  app.get("/api/agent-providers", async () => agent.listProviders());

  app.get("/api/settings", async () => storage.readSettings());

  app.post("/api/settings", async (request) => {
    const body = (request.body || {}) as Record<string, unknown>;
    const settings = await storage.readSettings();
    if ("agentProvider" in body) {
      const provider = normalizeProvider(body.agentProvider);
      // Empty string clears the preference and falls back to the daemon default.
      settings.agentProvider = provider;
    }
    return storage.writeSettings(settings);
  });

  app.get("/api/captures", async () => ({ captures: await storage.listCaptures() }));

  app.get<{ Params: { id: string } }>("/api/captures/:id", async (request, reply) => {
    const capture = await storage.readCapture(request.params.id);
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
    const update: { urgency?: 1 | 2 | 3; importance?: 1 | 2 | 3 } = {};
    const urgency = Number(body.urgency);
    const importance = Number(body.importance);
    if (urgency === 1 || urgency === 2 || urgency === 3) update.urgency = urgency;
    if (importance === 1 || importance === 2 || importance === 3) update.importance = importance;
    if (update.urgency === undefined && update.importance === undefined) {
      return reply.code(400).send({ error: "urgency or importance required" });
    }
    try {
      return { item: await storage.updateItemMeta(request.params.id, update) };
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
          if (item) return cliJson({ item });
          const capture = await storage.readCapture(id);
          if (capture) return cliJson({ capture });
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
                intent: data.primaryIntent,
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
