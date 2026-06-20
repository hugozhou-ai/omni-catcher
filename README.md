# Omni Catcher

A Tutti workspace app. Capture anything — an article, links, or todos — and a Tutti
agent classifies the intent (note / bookmark / todo / mixed). After you confirm, the
result is saved as a local Markdown file you can browse, search, and reference with
`@omni-catcher`.

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
│   │           ├── agentService.ts         # agent start/poll/messages
│   │           ├── classificationService.ts# rule preview + JSON parse
│   │           ├── storageService.ts       # markdown + index.jsonl (+ mutex)
│   │           ├── captureService.ts       # capture lifecycle orchestration
│   │           ├── referenceService.ts     # @mention file search
│   │           └── issueService.ts         # optional Tutti issue creation
│   └── web/                    # React + Vite UI
│       └── src/
│           ├── platform/        # React DI provider + observable Store
│           ├── services/        # UI services (api/capture/library/...)
│           ├── features/        # capture / pending / library panels
│           ├── components/      # Badge, Spinner, Toast
│           └── i18n/            # en / zh-CN dictionaries
├── packages/
│   └── shared/                 # contracts + DI platform reused by both apps
│       └── src/
│           ├── domain.ts        # Capture / Item / Classification DTOs
│           ├── cli.ts           # CLI invoke envelope + output helpers
│           ├── references.ts    # reference search contract
│           └── platform/        # instantiation (DI) + log services
├── scripts/package-tutti-app.mjs  # builds the runnable Tutti package
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

Open http://localhost:5173. Without a real `TUTTI_CLI`, agent classification degrades to a
rule-based fallback so the UI stays usable.

Useful scripts:

```bash
pnpm typecheck      # type-check every workspace
pnpm build          # build shared + server + web
pnpm package:tutti  # produce build/tutti-app/package (the runnable Tutti package)
```

## How it runs inside Tutti

1. Tutti runs `bootstrap.sh` (no args) from the packaged app directory.
2. `bootstrap.sh` launches `server/server.js` with `$TUTTI_APP_NODE`, binding `$TUTTI_APP_HOST:$TUTTI_APP_PORT`.
3. The server serves the built web assets and the `/api`, `/tutti/cli/*`, and
   `/tutti/references/{list,search}` endpoints.
4. Durable data is written only under `$TUTTI_APP_DATA_DIR`.

There is no lightweight LLM endpoint in Tutti, so classification uses a full agent session
(`agent start` → poll `agent get` → read `agent session-summary`). It runs on a background
task; `POST /api/capture` returns immediately and the UI polls for the result.

## CLI

Scope `omni-catcher` (see [COMMANDS.md](COMMANDS.md)):

```bash
tutti --json omni-catcher capture --content "..."
tutti --json omni-catcher list --type note
tutti --json omni-catcher search --query "react"
```
