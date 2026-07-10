---
name: organize-library
description: Organize existing Omni Catcher Markdown files using shell commands and scripts.
---

# Organize Library

Inspect the existing Markdown files, then directly perform the requested organization. You may edit, merge, split, rename, move between type directories, or delete files when the request clearly requires it.

- Work only under `notes/`, `bookmarks/`, and `todos/`.
- Never edit `index.jsonl`; Omni Catcher rebuilds it after the run.
- Preserve valid YAML frontmatter and update `type`, `title`, `summary`, `tags`, and `confirmedAt` after edits.
- When moving an item between types, move it into the matching directory and apply that domain skill's body/frontmatter rules.
- When merging, retain unique source material and provenance links before removing true duplicates.
- Do not delete content merely because it looks similar; confirm duplication from the file bodies or stable identifiers.
- Prefer small, auditable shell commands or scripts and inspect results before finishing.
