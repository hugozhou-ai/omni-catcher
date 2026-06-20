import { createServiceIdentifier } from "@omni-catcher/shared/platform";

interface TuttiAppContext {
  get?(): Promise<{ locale?: string; language?: string }>;
  subscribe?(listener: (context: { locale?: string; language?: string }) => void): () => void;
  locale?: string;
  language?: string;
}

declare global {
  interface Window {
    tutti?: { appContext?: TuttiAppContext };
    tuttiAppContext?: TuttiAppContext;
  }
}

export interface IHostBridgeService {
  readLocale(): Promise<string | null>;
  subscribeLocale(listener: (locale: string | null) => void): () => void;
}

export const IHostBridgeService = createServiceIdentifier<IHostBridgeService>("hostBridgeService");

export class HostBridgeService implements IHostBridgeService {
  private context(): TuttiAppContext | undefined {
    return window.tutti?.appContext || window.tuttiAppContext;
  }

  async readLocale(): Promise<string | null> {
    const ctx = this.context();
    if (!ctx) return null;
    if (typeof ctx.get === "function") {
      const value = await ctx.get();
      return value?.locale || value?.language || null;
    }
    return ctx.locale || ctx.language || null;
  }

  subscribeLocale(listener: (locale: string | null) => void): () => void {
    const ctx = this.context();
    if (ctx && typeof ctx.subscribe === "function") {
      return ctx.subscribe((value) => listener(value?.locale || value?.language || null));
    }
    return () => {};
  }
}
