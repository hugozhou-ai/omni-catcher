# Omni Catcher — package guidance

Omni Catcher is a Tutti workspace app. The user captures arbitrary content; a Tutti
agent session classifies the intent (note / bookmark / todo / mixed); after the user
confirms, the result is written as a local Markdown file.

The repository is a `pnpm` monorepo (`apps/web`, `apps/server`, `packages/shared`) built
into a self-contained package via `scripts/package-tutti-app.mjs`. Both apps use a VS
Code–style service layer: interfaces bound to typed service identifiers, wired in a
composition root, resolved through a small DI container (`packages/shared/src/platform`).

## Repository layout

- `packages/shared` — DTO contracts (`domain.ts`, `cli.ts`, `references.ts`) + the DI/log platform.
- `apps/server` — Node + Fastify runtime. Domain services in `src/services/`, routes in `src/http/routes.ts`, composition root in `src/registry.ts`.
- `apps/web` — React + Vite UI. UI services in `src/services/`, panels in `src/features/`, DI/Store in `src/platform/`, copy in `src/i18n/`.
- `scripts/package-tutti-app.mjs` — builds shared + web, bundles the server with esbuild, assembles `build/tutti-app/package`.

## Packaged layout (what Tutti runs)

- `tutti.app.json` — manifest (`tutti.app.manifest.v1`). Declares `cli.manifest`, `references.listEndpoint`, and `references.searchEndpoint`.
- `tutti.cli.json` — CLI manifest (`tutti.app.cli.v1`), scope `omni-catcher`.
- `bootstrap.sh` — launches `server/server.js` with `$TUTTI_APP_NODE`. No install/build work.
- `server/server.js` — bundled Node server (all deps inlined; no `node_modules` needed).
- `dist/` — built web assets, served by the server.
- `prompts/`, `locales/`, `icon.svg`, `AGENTS.md`, `COMMANDS.md`.

## Runtime

- Tutti runs `bootstrap.sh` (no args); `TUTTI_APP_PACKAGE_DIR` points at the package root.
- Server binds `$TUTTI_APP_HOST:$TUTTI_APP_PORT`; launched via `$TUTTI_APP_NODE`.
- Durable data is written only under `$TUTTI_APP_DATA_DIR`:
  - `inbox/<capId>.json` — transient pending capture state.
  - `notes/`, `bookmarks/`, `todos/` — confirmed Markdown items with YAML frontmatter.
  - `index.jsonl` — list/search index; source of truth is the Markdown files (rebuildable via `POST /api/rebuild-index`).
  - `settings.json` — preferred agent provider.
- `StorageService` serializes all index/file writes through an async `Mutex` (`apps/server/src/util.ts`).

## Agent integration (via `$TUTTI_CLI`)

There is no lightweight LLM endpoint; classification uses a full agent session
(`AgentService` in `apps/server/src/services/agentService.ts`):

1. `agent start --provider <p> --cwd $TUTTI_APP_DATA_DIR --title ... --prompt <classify.md> --visible` → `session.id`
2. poll `agent get --session-id <id>` until a terminal status
3. `agent session messages --session-id <id> --limit 80` → final assistant text → strict JSON

`CaptureService.create` returns immediately and runs classification on a background task; the
UI polls `GET /api/captures`. On agent failure/timeout the capture falls back to a rule-based
classification with `status: needs_review`. Provider list comes from `agent providers`
filtered to available `codex` / `claude-code` / `gemini`. The optional `todo` → issue upgrade
(`IssueService`) calls `issue topic list` then `issue create`; `issue` is a reserved daemon
scope this app only calls, never exposes.

## HTTP endpoints

- `GET /healthz`; `GET /` + `/assets/*` — UI.
- `GET /api/context`, `GET /api/agent-providers`, `GET|POST /api/settings`.
- `POST /api/capture` `{content, url?, source?}`; `GET /api/captures`, `GET /api/captures/:id`.
- `POST /api/captures/:id/confirm` `{intent?, edits?, writeIssue?}`, `POST /api/captures/:id/reject`.
- `GET /api/items[?type=]`, `GET /api/items/:id`, `POST /api/rebuild-index`.
- `POST /tutti/cli/:command` — CLI handlers (receive the `tutti.app.cli.invoke.v1` envelope; params in `input`).
- `POST /tutti/references/list` + `POST /tutti/references/search` — `@omni-catcher` file references. Each response is `{items, nextCursor}` where every item is a tagged wrapper `{type:"reference", reference:{kind:"file", location:{type:"app-data-relative", path}}}` (a bare file reference is silently dropped by the daemon).

## Modification guidance

- Keep contracts in `packages/shared`; do not duplicate business logic between `/api/*` and `/tutti/cli/*` — both call the same services.
- Read locale from `window.tutti.appContext` / browser locale APIs; theme from `prefers-color-scheme`. Never read locale/theme from URL query.
- Keep runtime writes out of `TUTTI_APP_PACKAGE_DIR`.
- After changing endpoints, data files, CLI commands, or storage rules, update this file and `README.md`.
- Run `pnpm typecheck` and `pnpm package:tutti` before shipping.
