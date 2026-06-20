/** The envelope Tutti POSTs to an app's `/tutti/cli/*` handlers. */
export interface CliInvokeEnvelope {
  schemaVersion?: string;
  commandId?: string;
  appId?: string;
  scope?: string;
  path?: string[];
  workspaceId?: string;
  input?: Record<string, unknown>;
  outputMode?: string;
  context?: unknown;
}

export interface CliTableColumn {
  key: string;
  label: string;
}

export type CliCommandOutput =
  | { kind: "json"; value: unknown }
  | { kind: "table"; columns?: CliTableColumn[]; rows: Array<Record<string, unknown>> };

export interface CliErrorBody {
  error: { code: string; message: string };
}

export function cliJson(value: unknown): CliCommandOutput {
  return { kind: "json", value };
}

export function cliTable(rows: Array<Record<string, unknown>>, columns?: CliTableColumn[]): CliCommandOutput {
  return columns ? { kind: "table", columns, rows } : { kind: "table", rows };
}
