import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import type { Classification, IssueResult } from "@omni-catcher/shared";
import type { ITuttiCliService } from "./tuttiCliService.js";

export interface IIssueService {
  createFromTodo(classification: Classification, content: string): Promise<IssueResult>;
}

export const IIssueService = createServiceIdentifier<IIssueService>("issueService");

export class IssueService implements IIssueService {
  constructor(private readonly cli: ITuttiCliService) {}

  async createFromTodo(classification: Classification, content: string): Promise<IssueResult> {
    const title =
      classification.todoUpgrade.suggestedIssueTitle || classification.title || "Todo";
    try {
      const topics = await this.cli.run(["issue", "topic", "list"], 30_000);
      const list = ((topics.topics as unknown[]) || (topics.items as unknown[]) || []) as Array<
        Record<string, unknown>
      >;
      const topicId = list[0] ? String(list[0].id || "").trim() : "";
      if (!topicId) return { created: false, error: "no issue topic available" };
      const body = classification.extractedTasks.map((task) => `- [ ] ${task}`).join("\n") || content;
      const issue = await this.cli.run(
        ["issue", "create", "--topic-id", topicId, "--title", title, "--content", body],
        30_000,
      );
      return { created: true, issue };
    } catch (error) {
      return { created: false, error: (error as Error).message };
    }
  }
}
