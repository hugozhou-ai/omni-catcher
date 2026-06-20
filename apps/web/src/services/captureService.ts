import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import type { Capture, ConfirmEdits, ConfirmResult } from "@omni-catcher/shared";
import { Store } from "../platform/store.js";
import type { IApiService } from "./apiService.js";

export interface ConfirmRequest {
  intent: string;
  writeIssue: boolean;
  edits: ConfirmEdits;
}

export interface ICaptureService {
  readonly captures: Store<Capture[]>;
  refresh(): Promise<boolean>;
  create(content: string): Promise<void>;
  confirm(id: string, request: ConfirmRequest): Promise<ConfirmResult>;
  reject(id: string): Promise<void>;
  startPolling(): void;
}

export const ICaptureService = createServiceIdentifier<ICaptureService>("webCaptureService");

const POLL_INTERVAL_MS = 2500;

export class WebCaptureService implements ICaptureService {
  readonly captures = new Store<Capture[]>([]);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly api: IApiService) {}

  async refresh(): Promise<boolean> {
    const data = await this.api.get<{ captures: Capture[] }>("/api/captures");
    this.captures.set(data.captures || []);
    return (data.captures || []).some((capture) => capture.status === "classifying");
  }

  async create(content: string): Promise<void> {
    await this.api.post("/api/capture", { content, source: "paste" });
    await this.refresh();
    this.startPolling();
  }

  async confirm(id: string, request: ConfirmRequest): Promise<ConfirmResult> {
    const result = await this.api.post<ConfirmResult>(`/api/captures/${id}/confirm`, request);
    await this.refresh();
    return result;
  }

  async reject(id: string): Promise<void> {
    await this.api.post(`/api/captures/${id}/reject`);
    await this.refresh();
  }

  startPolling(): void {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      const stillClassifying = await this.refresh().catch(() => false);
      if (!stillClassifying && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }, POLL_INTERVAL_MS);
  }
}
