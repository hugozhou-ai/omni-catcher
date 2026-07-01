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
  create(content: string): Promise<Capture>;
  cancel(id: string): Promise<{ content: string }>;
  retry(id: string): Promise<Capture>;
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

  async create(content: string): Promise<Capture> {
    const data = await this.api.post<{ capture: Capture }>("/api/capture", { content, source: "paste" });
    await this.refresh();
    this.startPolling();
    return data.capture;
  }

  async cancel(id: string): Promise<{ content: string }> {
    const result = await this.api.post<{ canceled: true; content: string }>(`/api/captures/${id}/cancel`);
    await this.refresh();
    return { content: result.content || "" };
  }

  async retry(id: string): Promise<Capture> {
    const result = await this.api.post<{ capture: Capture }>(`/api/captures/${id}/retry`);
    await this.refresh();
    this.startPolling();
    return result.capture;
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
