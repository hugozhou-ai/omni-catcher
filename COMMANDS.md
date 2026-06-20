# Omni Catcher CLI

Scope: `omni-catcher`. Invoke via the Tutti CLI, e.g. `tutti --json omni-catcher list`.

## Commands

- `capture --content "..."` / `capture --url "..."`
  Capture content. Classification runs asynchronously; the response returns the capture
  `id` and `status`. Poll with `get --id <id>` or confirm in the UI.

- `list [--type note|bookmark|todo]`
  List confirmed items (table).

- `get --id <id>`
  Get a confirmed item or a pending capture by id (json).

- `pending`
  List captures awaiting confirmation (table).

- `confirm --id <id> [--intent note|bookmark|todo]`
  Confirm a classified capture and write it to disk.

- `search --query "..."`
  Full-text search across saved items (table).

## Notes

- Classification and the optional summary use a Tutti agent session, so `capture` does not
  block on the agent; it returns once the capture is queued.
- Confirmed items are Markdown files under the app data directory and are referenceable via
  `@omni-catcher` mentions.
