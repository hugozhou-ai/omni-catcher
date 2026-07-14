# Omni Catcher — package guidance

Omni Catcher is a Tutti workspace app driven by one working Agent. Every run registers
all app-owned skills; the Agent decides whether to create, organize, or query and chooses
the note/bookmark/todo skills itself. Create and organize operations work directly on the
local Markdown library; query operations read it and return an answer.

The repository is a `pnpm` monorepo (`apps/web`, `apps/server`, `packages/shared`) built
into a self-contained package via `scripts/package-tutti-app.mjs`. Both apps use a VS
Code–style service layer: interfaces bound to typed service identifiers, wired in a
composition root, resolved through a small DI container (`packages/shared/src/platform`).
Development and packaging require Node.js 22 or newer.

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
- `prompts/`, `skills/`, `locales/`, `icon.svg`, `AGENTS.md`, `COMMANDS.md`.

## Runtime

- Tutti runs `bootstrap.sh` (no args); `TUTTI_APP_PACKAGE_DIR` points at the package root.
- Server binds `$TUTTI_APP_HOST:$TUTTI_APP_PORT`; launched via `$TUTTI_APP_NODE`.
- Durable data is written only under `$TUTTI_APP_DATA_DIR`:
  - `inbox/<capId>.json` — transient pending capture state.
  - `notes/`, `bookmarks/`, `todos/` — confirmed Markdown items with YAML frontmatter.
  - `index.jsonl` — list/search index; source of truth is the Markdown files (rebuildable via `POST /api/rebuild-index`).
  - `settings.json` — preferred exact Agent Target ID (`agentTargetId`). Legacy
    `agentProvider` is migrated only when the full catalog has one matching target.
- On startup, when the injected data dir is empty, `StorageService.init()` migrates from
  legacy `~/.tutti/apps/workspaces/<ws>/omni-catcher/data`, other installation copies, or
  `~/.tutti/apps/installations/omni-catcher/.data-backup` if present.
- `StorageService` serializes all index/file writes through an async `Mutex` (`apps/server/src/util.ts`).
- The Agent cwd is `$TUTTI_APP_DATA_DIR`. Skills restrict direct work to `notes/`,
  `bookmarks/`, and `todos/`; the Agent must not edit `index.jsonl`. After create/organize,
  `CaptureService` rebuilds the index from Markdown. Agent runs are serialized so two captures
  cannot edit the shared library concurrently.
- Legacy `Classification`, `savePlan`, and manual confirmation remain only for captures created
  by older releases and for the rule-based review shown when an Agent run fails.
- Deleting a library item removes its Markdown file and rewrites `index.jsonl`; source
  of truth remains the Markdown directory, so `POST /api/rebuild-index` can recover the index.

## Agent integration

There is no lightweight LLM endpoint; the working Agent uses the server-only
`@tutti-os/agent-acp-kit` local runtime plus its Tutti integration helpers
(`AgentService` in `apps/server/src/services/agentService.ts`):

1. load the app-scoped Agent Target catalog and select one exact `agentTargetId`
2. load target-scoped composer options and host skills, then register every app-owned
   skill from `skills/` through the same `skillManifest`
3. stream one local Agent run in the data directory; the Agent routes and executes the task
4. validate the final strict JSON result and rebuild `index.jsonl` after Markdown writes

The selected provider ID is runtime metadata only. Every capture explicitly starts a fresh
runtime session; resume state is never reused across Agent Targets. Compatibility reads of
`agentProvider` fail closed when more than one catalog target uses that provider. Settings
responses project the deprecated field only for an unambiguous target so cached legacy web
clients can still read their preference during the migration window.

`CaptureService.create` returns immediately and runs the Agent on a background task; the
UI polls `GET /api/captures`. While a capture is running, `CaptureService` keeps only the
active session id and latest activity text in memory and temporarily merges `activityText`
into API responses; it is not written to `inbox/<capId>.json`. `POST
/api/captures/:id/cancel` cancels the active agent session when one exists, removes the
pending capture, and returns the original content so the UI can restore the input. On
Agent failure/timeout the capture falls back to a rule-based classification with `status:
needs_review`; `POST /api/captures/:id/retry` resets that same capture to `classifying`
and starts a new background Agent run. Agent Target and model selection comes from
the kit's app-scoped catalog and composer contract. The optional `todo` → issue
upgrade (`IssueService`) calls `issue topic list` then `issue create`; `issue` is a
reserved daemon scope this app only calls, never exposes.

## HTTP endpoints

- `GET /healthz`; `GET /` + `/assets/*` — UI.
- `GET /api/context`, `GET /api/agent-targets`, `GET|POST /api/settings`.
- Deprecated `GET /api/agent-providers` projects only providers that map to exactly one
  target in the full catalog; ambiguous providers are omitted.
- `POST /api/capture` `{content, url?, source?}`; `GET /api/captures`, `GET /api/captures/:id`.
- `POST /api/captures/:id/confirm` acknowledges a successful Agent result; for a legacy/rule-based review it accepts `{intent?, edits?, writeIssue?}` and performs the old deterministic write. Also: `POST /api/captures/:id/cancel`, `POST /api/captures/:id/retry`, `POST /api/captures/:id/reject`.
- `GET /api/items[?type=]`, `GET /api/items/:id`, `PATCH /api/items/:id` (todo meta), `PATCH /api/items/:id/content` `{body, title?, tags?}` (note/bookmark body), `PATCH /api/items/:id/todo-task`, `DELETE /api/items/:id`, `POST /api/rebuild-index`.
- `POST /tutti/cli/:command` — CLI handlers (receive the `tutti.app.cli.invoke.v1` envelope; params in `input`).
- `POST /tutti/references/list` + `POST /tutti/references/search` — `@omni-catcher` file references. Each response is `{items, nextCursor}` where every item is a tagged wrapper `{type:"reference", reference:{kind:"file", location:{type:"app-data-relative", path}}}` (a bare file reference is silently dropped by the daemon).

## Modification guidance

- Keep contracts in `packages/shared`; do not duplicate business logic between `/api/*` and `/tutti/cli/*` — both call the same services.
- Read locale from `window.tutti.appContext` / browser locale APIs; theme from `prefers-color-scheme`. Never read locale/theme from URL query.
- Keep runtime writes out of `TUTTI_APP_PACKAGE_DIR`.
- App-owned skills live under `skills/<slug>/SKILL.md`; every skill is registered for every
  Agent run, and skill selection belongs to the Agent rather than server routing code.
- After changing endpoints, data files, CLI commands, or storage rules, update this file and `README.md`.
- Run `pnpm typecheck` and `pnpm package:tutti` before shipping.
