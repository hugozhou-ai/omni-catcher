import { existsSync } from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { loadConfig } from "./config.js";
import { createServices } from "./registry.js";
import { registerRoutes } from "./http/routes.js";
import { IStorageService } from "./services/storageService.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const services = createServices(config);
  await services.get(IStorageService).init();

  const app = Fastify({ logger: false });

  registerRoutes(app, services);

  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: "/" });
  }

  await app.listen({ host: config.host, port: config.port });
  console.log(`[omni-catcher] listening on ${config.host}:${config.port}`);
}

main().catch((error) => {
  console.error("[omni-catcher] failed to start:", error);
  process.exit(1);
});
