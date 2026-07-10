---
name: intent-router
description: Decide whether an Omni Catcher request creates content, organizes existing content, or queries the existing library.
---

# Intent Router

Always use this skill first.

Determine one primary purpose:

- `create`: create new notes, bookmarks, or todos from the input.
- `organize`: edit, merge, split, retag, move, or delete existing Markdown items.
- `query`: answer a question using the existing Markdown library without changing it.

Then determine the relevant content intents: `note`, `bookmark`, `todo`, or any combination. Load and follow the matching domain skills yourself. If a request contains several purposes, complete them in the order the user requested, using the updated Markdown state between operations.

Do not treat imperative wording as a todo by itself. A request to create or organize a note is a note operation; a todo is future work the user wants tracked.
