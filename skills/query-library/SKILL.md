---
name: query-library
description: Answer questions from the existing Omni Catcher Markdown library without modifying it.
---

# Query Library

Use shell search and file-reading commands to inspect `notes/`, `bookmarks/`, and `todos/`. Do not create, edit, move, or delete files for a query.

- Base the answer only on files you actually read.
- Mention supporting item titles and data-relative paths in the answer.
- If the library does not contain enough evidence, say so clearly.
- For todo questions, inspect checkbox state and frontmatter priority/progress.
- Never read secrets or files outside the three library directories.
