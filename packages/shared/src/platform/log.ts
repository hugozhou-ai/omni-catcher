import { createServiceIdentifier } from "./instantiation.js";

export interface ILogService {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export const ILogService = createServiceIdentifier<ILogService>("logService");

export class ConsoleLogService implements ILogService {
  constructor(private readonly scope: string) {}

  info(message: string, ...args: unknown[]): void {
    console.log(`[${this.scope}] ${message}`, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(`[${this.scope}] ${message}`, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.error(`[${this.scope}] ${message}`, ...args);
  }
}
