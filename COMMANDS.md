# Omni Catcher CLI

Scope: `omni-catcher`. Invoke via the Tutti CLI, e.g. `tutti --json omni-catcher list`.

## Commands

- `capture --content "..."` / `capture --url "..."`
  Send a request to the single Omni Catcher Agent. The Agent chooses whether to create,
  organize, or query, selects its registered skills, and works asynchronously. The response
  returns the capture `id` and `status`; poll with `get --id <id>`.

- `list [--type note|bookmark|todo]`
  List confirmed items (table).

- `get --id <id>`
  Get a confirmed item or a pending capture by id (json).

- `pending`
  List captures awaiting confirmation (table).

- `confirm --id <id> [--intent note|bookmark|todo]`
  Acknowledge a completed Agent result. If the Agent failed and the capture uses the
  rule-based review, confirm writes that fallback result to disk.

- `search --query "..."`
  Full-text search across saved items (table).

## Notes

- One Tutti Agent session receives every app-owned skill and directly reads or edits Markdown
  under the app data directory. `capture` returns once the request is queued.
- Confirmed items are Markdown files under the app data directory and are referenceable via
  `@omni-catcher` mentions.
