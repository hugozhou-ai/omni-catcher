# Omni Catcher

A Tutti workspace app with one working Agent. Enter a request and the Agent decides whether
to create content, organize the existing library, or answer from it. The Agent selects from
the app's note, bookmark, and todo skills and works directly with local Markdown that can be
browsed, searched, and referenced with `@omni-catcher`.

## Product philosophy

Omni Catcher is an intelligent sticky note for a workspace: the user should only need
one habit — type anything into the capture box. The app gives one Agent all Omni Catcher
skills; the Agent infers the purpose, selects the skills, and completes the request against
the local Markdown library.

The central design idea is **capture first, organize second**:

- **One super entry point** — Capture is the primary workflow, not one tab among many.
  Articles, papers, links, tasks, and mixed notes all start from the same input.
- **One Agent owns routing and execution** — the app registers all built-in skills for one
  run. The Agent decides when to create, organize, or query and which content skills to use.
- **Links are content, not automatically bookmarks** — a URL may be an article, paper,
  tutorial, product, tool, dataset, or task reference. The Agent inspects the content and
  may use its normal shell or scripts when more context is needed.
- **Knowledge should consolidate when possible** — article and paper captures are meant
  to become notes, preferably organized into an existing document at the right place
  when enough context is available. Existing content should stay visible and subdued;
  newly inserted content should be visually distinct.
- **The Library is downstream of capture** — Todos, Notes, and Bookmarks are
  organization views over confirmed captures, not independent primary workflows.
- **Local-first, markdown-first** — confirmed items are durable Markdown files under the
  app data directory. `index.jsonl` supports fast browse/search but can be rebuilt from
  the Markdown source of truth.

## UI

The web UI is a single-page app where **Capture** is the primary entry point.
Saved content is organized later in the secondary **Library** area.

```text
┌─────────┬─────────────────────────────────────────┐
│ Capture │  Capture home (default, primary)        │
│ Library │  · request → Agent selects skills → result│
│         │  · library groups saved results         │
└─────────┴─────────────────────────────────────────┘
```

### Sidebar

| Icon | View | Purpose |
|------|------|---------|
| Capture | **Capture** | Primary entry point: create, organize, or query through one Agent |
| Grid | **Library** | Secondary organization area for all saved results |

The sidebar can collapse into an icon-only rail. Expanded mode shows the full Omni
Catcher wordmark; collapsed mode uses the compact app icon.

### Capture flow (in-place decision card)

There is no chat-style conversation UI — each capture is a single round trip:

1. **Idle** — logo, multi-line input, optional exact **Agent** selector, **Capture** button (`Cmd/Ctrl+Enter`).
2. **Processing** — a quote of what you sent, spinner, latest Agent activity, and a **Stop** action that cancels the run and restores the original input. Runs are serialized because the Agent edits the shared Markdown library directly.
3. **Result** — create/organize requests show the Agent summary and changed Markdown paths; query requests render the answer. Acknowledging the result returns to the input.
4. **Done** — returns to idle with an empty input.

If the Agent fails before returning a valid result, the existing rule-based review remains available for backward-compatible manual capture. Any Markdown already written by a failed/canceled Agent run remains the source of truth and the index is rebuilt.

### Library

- **All** — card grid across saved notes, bookmarks, and todos.
- **Notes / Bookmarks** — card grid with `summary` from Markdown frontmatter and `index.jsonl`. Click a card to preview the Markdown body rendered with the app Markdown viewer; delete removes both the Markdown source file and index entry.
- **Todos** — same card layout, plus **urgency** and **importance** (1–3). Toolbar supports filter/sort and a **List ↔ Matrix** toggle:
  - **List** — filter by urgency/importance, sort by newest / urgency / importance.
  - **Matrix** — Eisenhower 2×2 (important·urgent, important·not urgent, …). Drag a card into a quadrant to update its urgency/importance (`PATCH /api/items/:id`).

Large logo asset lives at `apps/web/public/omni-catcher-logo-large.webp` and is served as `/omni-catcher-logo-large.webp`.

## Architecture

A `pnpm` monorepo with a VS Code–style service layer on both the server and the web app:
each domain capability is an interface bound to a typed service identifier and resolved
through a small dependency-injection container (`packages/shared/src/platform`).

```text
omni-catcher/
├── apps/
│   ├── server/                 # Node + Fastify local runtime
│   │   └── src/
│   │       ├── server.ts        # entry: Fastify + static hosting
│   │       ├── config.ts        # runtime env / AppConfig service
│   │       ├── registry.ts      # composition root (ServiceCollection)
│   │       ├── http/routes.ts   # /api, /tutti/cli, /tutti/references
│   │       └── services/        # domain services
│   │           ├── tuttiCliService.ts      # $TUTTI_CLI browser/issue invocation
│   │           ├── agentService.ts         # agent-acp-kit catalog + streamed run
│   │           ├── skillRegistryService.ts # loads every app-owned skill for one Agent
│   │           ├── classificationService.ts# result validation + legacy rule preview
│   │           ├── storageService.ts       # markdown + index.jsonl (+ mutex)
│   │           ├── captureService.ts       # capture lifecycle orchestration
│   │           ├── referenceService.ts     # @mention file search
│   │           └── issueService.ts         # optional Tutti issue creation
│   └── web/                    # React + Vite UI
│       ├── public/             # omni-catcher-logo-large.webp (capture home branding)
│       └── src/
│           ├── platform/        # React DI provider + observable Store
│           ├── services/        # UI services (api/capture/library/...)
│           ├── components/      # Sidebar, ItemCard, Badge, Spinner, Toast
│           ├── features/
│           │   ├── capture/     # CaptureHome + DecisionCard
│           │   ├── todo/        # TodoPanel (list + Eisenhower matrix)
│           │   └── library/     # LibraryPanel + CollectionPanel
│           └── i18n/            # en / zh-CN dictionaries
├── packages/
│   └── shared/                 # contracts + DI platform reused by both apps
│       └── src/
│           ├── domain.ts        # Capture / Item / Classification DTOs
│           ├── cli.ts           # CLI invoke envelope + output helpers
│           ├── references.ts    # reference search contract
│           └── platform/        # instantiation (DI) + log services
├── scripts/
│   ├── package-tutti-app.mjs   # builds the runnable Tutti package
│   └── install-tutti-app.mjs   # installs/relaunches the package into Tutti (dev)
├── tutti.app.json              # manifest (cli + references.list/searchEndpoint)
├── tutti.cli.json              # CLI manifest (scope: omni-catcher)
├── bootstrap.sh                # production launcher (node server/server.js)
├── prompts/                    # agent prompt templates
├── skills/                     # intent, purpose, note/bookmark/todo skills
└── locales/zh-CN/manifest.json # localized manifest metadata
```

### Service layer (VS Code style)

- A service is an interface plus a `ServiceIdentifier<T>` created with `createServiceIdentifier`.
- Implementations are wired once in a composition root (`registry.ts`) into a `ServiceCollection`.
- Consumers resolve dependencies via `InstantiationService.get(IService)` (server) or the
  `useService(IService)` React hook (web). Lazy `SyncDescriptor` registration is supported.

## Develop

Development and packaging require Node.js 22.12 or newer. The combined dependency
constraint is set by Vite 7 (Node.js 22.12+) and `@tutti-os/agent-acp-kit` 0.7.8
(Node.js 22+).

```bash
pnpm install
pnpm dev            # builds shared, runs server (:3001) + web (:5173) with proxy
```

```bash
pnpm typecheck      # type-check every workspace
pnpm build          # build shared + server + web
pnpm package:tutti  # produce build/tutti-app/package (the runnable Tutti package)
pnpm install:tutti  # same as node scripts/install-tutti-app.mjs (see below)
```

Open http://localhost:5173 to exercise the sidebar + capture flow locally. Without a
locally discoverable Agent Target, capture degrades to the legacy rule-based review so
the UI stays usable. `TUTTI_CLI` remains optional for issue creation.

## How it runs inside Tutti

1. Tutti runs `bootstrap.sh` (no args) from the packaged app directory.
2. `bootstrap.sh` launches `server/server.js` with `$TUTTI_APP_NODE`, binding `$TUTTI_APP_HOST:$TUTTI_APP_PORT`.
3. The server serves the built web assets and the `/api`, `/tutti/cli/*`, and
   `/tutti/references/{list,search}` endpoints.
4. Durable data is written only under `$TUTTI_APP_DATA_DIR`.

There is no lightweight LLM endpoint in Tutti, so each request streams one local Agent run
through `@tutti-os/agent-acp-kit` 0.7.8. The app loads the Agent catalog, resolves an exact
`agentTargetId`, then loads target-scoped composer options and host skills. Provider ID is
kept only as runtime metadata. The app also registers every skill in `skills/` through
`skillManifest` and uses `$TUTTI_APP_DATA_DIR` as the Agent cwd. The Agent chooses skills and directly reads or
edits `notes/`, `bookmarks/`, and `todos/`; the server rebuilds `index.jsonl` afterward.
The run executes on a background task; `POST /api/capture` returns
immediately and the UI polls for the result and latest in-memory activity text. Processing
captures can be canceled with `POST /api/captures/:id/cancel`, which cancels the active
agent session when one exists, removes the pending capture, and returns the original
content for retry. Failed captures can be retried in place with
`POST /api/captures/:id/retry`, which resets the capture to `classifying` and starts a new
background Agent run. Completion comes directly from the normalized agent event
stream, so the app does not poll Tutti agent sessions. Captures always request a fresh
runtime session, so resume state cannot cross Agent Target boundaries.

## Install & debug in Tutti

Start the Tutti desktop app first (it runs the local `tuttid` daemon). Then, from the
repo root:

```bash
pnpm install
node scripts/install-tutti-app.mjs --bump   # package -> import -> install -> launch
```

The script targets `$TUTTI_WORKSPACE_ID` (or the most recently opened workspace) and
prints the launch URL plus the data/log paths. Open the app from the Tutti workbench —
use **Capture** as the primary entry point, then open **Library** for saved todos,
notes, and bookmarks.

> **Reinstalling: always `--bump`.** The daemon keys installed packages by version and
> will not overwrite an existing version with new contents, so every redeploy needs a new
> `tutti.app.json` version. `--bump` increments the patch version automatically.
>
> **Data survives upgrades.** `install-tutti-app.mjs` skips uninstall by default, keeps a
> stable backup under `~/.tutti/apps/installations/omni-catcher/.data-backup`, restores
> into the live installation data dir, and verifies `/api/items` after launch. The server
> also migrates from legacy `workspaces/.../data` on startup when the current data dir is
> empty. Use `--clean-install` only when a normal upgrade fails.

Useful flags: `--workspace <id>` to choose a workspace, `--no-package` to reinstall the
current `build/tutti-app/package` without rebuilding, `--clean-install` to uninstall first.

You can also install via the Tutti desktop App Center by importing a zip of
`build/tutti-app/package` (it must contain `tutti.app.json` at the archive root and an
executable `bootstrap.sh`).

### Where to look when debugging

For app id `omni-catcher` (current Tutti desktop layout):

```text
~/.tutti/apps/installations/omni-catcher/<install-id>/data/  # saved markdown + index.jsonl
~/.tutti/apps/installations/omni-catcher/<install-id>/logs/runtime.log
~/.tutti/apps/installations/omni-catcher/<install-id>/logs/web.log
~/.tutti/logs/tuttid.log                                     # daemon (agent + reference) logs
```

Confirm the live path from the running server: `curl :<port>/api/context` and read
`dataDir`. Older Tutti builds used `~/.tutti/apps/workspaces/<ws>/omni-catcher/data/`
instead; `scripts/install-tutti-app.mjs` now backs up/restores against the richest
source and writes back to the current installation data dir.

The server logs the exact Agent Target, runtime provider metadata, purpose/result metadata,
failures, and the runtime port
(`[omni-catcher] listening on 127.0.0.1:<port>`) — hit that port directly to bypass the
daemon while debugging (e.g. `curl :<port>/api/items`).

### Choosing the Agent Target

The working Agent uses the daemon's default Agent Target unless you pick one in the capture
home **Agent** selector (bottom of the input area). The exact selection is stored per
workspace in `$TUTTI_APP_DATA_DIR/settings.json` as `agentTargetId`. Settings are replaced
atomically, so concurrent captures and UI reads cannot observe a partially written
preference. Existing
`agentProvider` settings are migrated only when that provider maps to exactly one target in
the full catalog; shared providers fail closed instead of choosing an arbitrary Agent.
During the compatibility window, settings responses also project `agentProvider` for an
unambiguous exact target so older cached clients can continue reading their preference.

## CLI

Scope `omni-catcher` (see [COMMANDS.md](COMMANDS.md)). Set `TUTTI_WORKSPACE_ID` so the CLI
targets the workspace the app is installed in:

```bash
export TUTTI_WORKSPACE_ID=<ws>
tutti --json omni-catcher capture --content "..."
tutti --json omni-catcher pending
tutti --json omni-catcher confirm --id <capture-id> --intent note
tutti --json omni-catcher list --type note
tutti --json omni-catcher search --query "react"
```
