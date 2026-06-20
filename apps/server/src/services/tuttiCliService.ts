import { execFile } from "node:child_process";
import { createServiceIdentifier, type ILogService } from "@omni-catcher/shared/platform";

export interface ITuttiCliService {
  isConfigured(): boolean;
  run(args: string[], timeoutMs?: number): Promise<Record<string, unknown>>;
}

export const ITuttiCliService = createServiceIdentifier<ITuttiCliService>("tuttiCliService");

export class TuttiCliService implements ITuttiCliService {
  constructor(private readonly log: ILogService) {}

  private command(): string {
    const configured = (process.env.TUTTI_CLI || "").trim();
    if (!configured) {
      throw new Error("TUTTI_CLI is not configured");
    }
    return configured;
  }

  isConfigured(): boolean {
    return Boolean((process.env.TUTTI_CLI || "").trim());
  }

  run(args: string[], timeoutMs = 60_000): Promise<Record<string, unknown>> {
    const command = this.command();
    return new Promise((resolvePromise, reject) => {
      execFile(
        command,
        ["--json", ...args],
        { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            const message = (stderr || stdout || error.message || "tutti cli failed").trim();
            this.log.warn(`tutti cli failed: ${args.join(" ")} -> ${message}`);
            reject(new Error(message));
            return;
          }
          const text = stdout.trim();
          if (!text) {
            resolvePromise({});
            return;
          }
          try {
            resolvePromise(JSON.parse(text) as Record<string, unknown>);
          } catch (parseError) {
            reject(new Error(`failed to parse tutti cli output: ${(parseError as Error).message}`));
          }
        },
      );
    });
  }
}
