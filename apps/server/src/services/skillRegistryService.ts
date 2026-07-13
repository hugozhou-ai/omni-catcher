import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createServiceIdentifier } from "@omni-catcher/shared/platform";

export interface AppSkillManifest {
  skillId: string;
  slug: string;
  deliveryMode: "materialized-files";
  files: Array<{ path: string; content: string }>;
}

export interface ISkillRegistryService {
  loadAll(): Promise<AppSkillManifest[]>;
}

export const ISkillRegistryService = createServiceIdentifier<ISkillRegistryService>("skillRegistryService");

const APP_SKILLS = [
  "intent-router",
  "create-content",
  "organize-library",
  "query-library",
  "note",
  "bookmark",
  "todo",
] as const;

export class SkillRegistryService implements ISkillRegistryService {
  private cached: Promise<AppSkillManifest[]> | null = null;

  constructor(private readonly skillsDir: string) {}

  loadAll(): Promise<AppSkillManifest[]> {
    this.cached ??= Promise.all(
      APP_SKILLS.map(async (slug) => ({
        skillId: `omni-catcher:${slug}`,
        slug,
        deliveryMode: "materialized-files" as const,
        files: [{ path: "SKILL.md", content: await readFile(join(this.skillsDir, slug, "SKILL.md"), "utf-8") }],
      })),
    );
    return this.cached;
  }
}
