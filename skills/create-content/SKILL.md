---
name: create-content
description: Create one or more Omni Catcher Markdown items directly in the local data directory.
---

# Create Content

Use the note, bookmark, and todo skills that match the content. You may use shell commands or short scripts to inspect existing files and create Markdown files under `notes/`, `bookmarks/`, or `todos/`.

- Reuse an existing related document when the new content clearly belongs there.
- Avoid duplicates by checking titles, URLs, DOI/arXiv identifiers, and tags.
- Never edit `index.jsonl`; Omni Catcher rebuilds it after the run.
- Never write outside `notes/`, `bookmarks/`, and `todos/`.
- Use collision-safe filenames beginning with the current date.
- Preserve user-authored content and use the user's language unless a domain skill says otherwise.

Every created file must contain YAML frontmatter with: `id`, `type`, `status: confirmed`, `source: agent`, `title`, `summary`, `createdAt`, `confirmedAt`, and `tags`. Notes/bookmarks should also include `urls` when applicable. Todo files should include `urgency`, `importance`, and `todoProgress: todo`.
