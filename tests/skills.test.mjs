import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skills = [
  "intent-router",
  "create-content",
  "organize-library",
  "query-library",
  "note",
  "bookmark",
  "todo",
];

test("every app-owned skill has a complete SKILL.md", async () => {
  for (const slug of skills) {
    const path = resolve(root, "skills", slug, "SKILL.md");
    assert.equal((await stat(path)).isFile(), true, path);
    const content = (await readFile(path, "utf-8")).replaceAll("\r\n", "\n");
    assert.match(content, /^---\nname: /);
    assert.match(content, /\ndescription: .+\n---\n/);
  }
});

test("the single-Agent prompt delegates skill selection and requires strict JSON", async () => {
  const prompt = await readFile(resolve(root, "prompts", "agent.md"), "utf-8");
  assert.match(prompt, /All Omni Catcher skills are registered/);
  assert.match(prompt, /autonomously choose/);
  assert.match(prompt, /strict JSON only/);
  assert.match(prompt, /\{\{CONTENT\}\}/);
});

test("the package builder includes app-owned skills", async () => {
  const builder = await readFile(resolve(root, "scripts", "package-tutti-app.mjs"), "utf-8");
  assert.match(builder, /"skills"/);
});
