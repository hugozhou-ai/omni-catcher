---
name: todo
description: Create or organize actionable tasks, reminders, and checklists.
---

# Todo

Write GitHub-style checkbox lists with one actionable task per line. Split compound actions without inventing work. Preserve the user's language.

Todo frontmatter must use `type: todo`, `todoProgress: todo|doing|done`, and numeric `urgency` and `importance` from 1 to 3. Infer priority only when the input supports it; otherwise use 2. A request to create or organize a note/bookmark is not itself a todo.
