# Omni Catcher

A Tutti workspace app. Capture anything — an article, links, or todos — and a Tutti
agent classifies the intent (note / bookmark / todo / mixed). After you confirm, the
result is saved as a local Markdown file you can browse, search, and reference with
`@omni-catcher`.

## Product philosophy

Omni Catcher is an intelligent sticky note for a workspace: the user should only need
one habit — paste anything into the capture box. The app then uses an Agent to infer
what the captured material wants to become, shows the decision clearly, and writes the
confirmed result into local Markdown.

The central design idea is **capture first, organize second**:

- **One super entry point** — Capture is the primary workflow, not one tab among many.
  Articles, papers, links, tasks, and mixed notes all start from the same input.
- **Agent as classifier, user as editor** — the Agent proposes an intent, title,
  summary, tags, split items, or todo upgrade; the user can inspect the detail, change
  the intent, and confirm or discard.
- **Links are content, not automatically bookmarks** — a URL may be an article, paper,
  tutorial, product, tool, dataset, or task reference. The server enriches URLs with
  page title/description/excerpt before classification so the Agent can decide based on
  meaning rather than URL shape alone.
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
│ Library │  · paste → Agent classifies → confirm   │
│         │  · library groups saved results         │
└─────────┴─────────────────────────────────────────┘
```

### Sidebar

| Icon | View | Purpose |
|------|------|---------|
| Capture | **Capture** | Primary entry point: paste content, run Agent classification, confirm once |
| Grid | **Library** | Secondary organization area for all saved results |

The sidebar can collapse into an icon-only rail. Expanded mode shows the full Omni
Catcher wordmark; collapsed mode uses the compact app icon.

### Capture flow (in-place decision card)

There is no chat-style conversation UI — each capture is a single round trip:

1. **Idle** — logo, multi-line input, optional **Agent** provider selector, **Capture** button (`Cmd/Ctrl+Enter`).
2. **Processing** — a quote of what you sent, spinner, and “Agent is classifying…”.
3. **Review** — one **decision card** on the same screen: intent pills, editable title/tags, Agent summary, confirm or discard.
   Related saved notes/bookmarks are included in the Agent prompt. When a pasted paper or
   article matches an existing item, the card proposes a merge target instead of creating
   another duplicate note; when a collection-style target is suggested, confirmation can
   create that summary note for future related captures.
4. **Done** — returns to idle with an empty input.

If the Agent is unavailable, the card falls back to rule-based classification and shows a short “needs review” notice; you still pick the intent manually.

### Library

- **All** — card grid across saved notes, bookmarks, and todos.
- **Notes / Bookmarks** — card grid with `summary` from classification (stored in frontmatter and `index.jsonl`). Click a card to preview the Markdown body rendered with the app Markdown viewer; delete removes both the Markdown source file and index entry.
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
│   │           ├── tuttiCliService.ts      # $TUTTI_CLI invocation
│   │           ├── agentService.ts         # agent start/poll/session-summary
│   │           ├── classificationService.ts# rule preview + JSON parse
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
└── locales/zh-CN/manifest.json # localized manifest metadata
```

### Service layer (VS Code style)

- A service is an interface plus a `ServiceIdentifier<T>` created with `createServiceIdentifier`.
- Implementations are wired once in a composition root (`registry.ts`) into a `ServiceCollection`.
- Consumers resolve dependencies via `InstantiationService.get(IService)` (server) or the
  `useService(IService)` React hook (web). Lazy `SyncDescriptor` registration is supported.

## Develop

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

Open http://localhost:5173 to exercise the sidebar + capture flow locally. Without a real
`TUTTI_CLI`, agent classification degrades to a rule-based fallback so the UI stays usable.

## How it runs inside Tutti

1. Tutti runs `bootstrap.sh` (no args) from the packaged app directory.
2. `bootstrap.sh` launches `server/server.js` with `$TUTTI_APP_NODE`, binding `$TUTTI_APP_HOST:$TUTTI_APP_PORT`.
3. The server serves the built web assets and the `/api`, `/tutti/cli/*`, and
   `/tutti/references/{list,search}` endpoints.
4. Durable data is written only under `$TUTTI_APP_DATA_DIR`.

There is no lightweight LLM endpoint in Tutti, so classification uses a full agent session
(`agent start` → poll `agent get` for failures → read `agent session-summary` for the
completed assistant turn). It runs on a background task; `POST /api/capture` returns
immediately and the UI polls for the result. ACP providers (e.g. claude-code) keep the
session open after a turn, so completion is detected from the newest `completed` assistant
message rather than the session status.

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

Useful flags: `--workspace <id>` to choose a workspace, `--no-package` to reinstall the
current `build/tutti-app/package` without rebuilding.

You can also install via the Tutti desktop App Center by importing a zip of
`build/tutti-app/package` (it must contain `tutti.app.json` at the archive root and an
executable `bootstrap.sh`).

### Where to look when debugging

For workspace `<ws>` and app id `omni-catcher`:

```text
~/.tutti/apps/workspaces/<ws>/omni-catcher/logs/runtime.log  # server stdout/stderr
~/.tutti/apps/workspaces/<ws>/omni-catcher/logs/web.log      # webview diagnostics
~/.tutti/apps/workspaces/<ws>/omni-catcher/data/             # saved markdown + index.jsonl
~/.tutti/logs/tuttid.log                                     # daemon (agent + reference) logs
```

The server logs the agent provider, classification failures, and the runtime port
(`[omni-catcher] listening on 127.0.0.1:<port>`) — hit that port directly to bypass the
daemon while debugging (e.g. `curl :<port>/api/items`).

### Choosing the agent provider

Classification uses the daemon's default provider unless you pick one in the capture
home **Agent** selector (bottom of the input area). If the default (often codex) is
rate-limited, choose an available provider such as `claude-code`; the preference is
stored per workspace in `$TUTTI_APP_DATA_DIR/settings.json` (`agentProvider`).

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
