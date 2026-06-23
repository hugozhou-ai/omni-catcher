import { createServiceIdentifier } from "@omni-catcher/shared/platform";

export interface IApiService {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

export const IApiService = createServiceIdentifier<IApiService>("apiService");

export class HttpApiService implements IApiService {
  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    const hasBody = body !== undefined;
    return this.request<T>(path, {
      method: "POST",
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(body) : undefined,
    });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    const hasBody = body !== undefined;
    return this.request<T>(path, {
      method: "PATCH",
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(path, init);
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : {};
    if (!response.ok) {
      const error = (data as { error?: unknown }).error;
      const message =
        typeof error === "string"
          ? error
          : error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : response.statusText;
      throw new Error(message);
    }
    return data as T;
  }
}
