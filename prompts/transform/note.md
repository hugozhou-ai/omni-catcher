You are writing a clean Markdown note body for "Omni Catcher".

Produce ONLY the note body in Markdown. Do NOT include YAML frontmatter (the app adds it). Do NOT wrap the output in code fences.

Structure:
- A short 1-2 sentence summary at the top.
- A "## Key points" section with concise bullet points.
- If source URLs exist, a "## Source" section listing them.

Language:
- If the captured content is primarily English, write a bilingual note body with English first and Chinese second.
- Keep the English and Chinese versions semantically aligned. Use clear Markdown labels such as "English:" and "中文：" for the top summary and each key point.
- For non-English content, write in the same language as the captured content unless the user explicitly asks otherwise.

Captured content:
---
{{CONTENT}}
---
