import { createServiceIdentifier } from "@omni-catcher/shared/platform";

interface TuttiAppContext {
  get?(): Promise<{ locale?: string; language?: string }>;
  subscribe?(listener: (context: { locale?: string; language?: string }) => void): () => void;
  locale?: string;
  language?: string;
}

interface TuttiExternalAppContext {
  getContext?(): Promise<{ locale?: string; language?: string }>;
  subscribe?(listener: (context: { locale?: string; language?: string }) => void): () => void;
}

declare global {
  interface Window {
    tuttiExternal?: { app?: TuttiExternalAppContext };
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
  private legacyContext(): TuttiAppContext | undefined {
    return window.tutti?.appContext || window.tuttiAppContext;
  }

  async readLocale(): Promise<string | null> {
    const app = window.tuttiExternal?.app;
    if (typeof app?.getContext === "function") {
      try {
        const value = await app.getContext();
        return value?.locale || value?.language || null;
      } catch {
        return null;
      }
    }

    const ctx = this.legacyContext();
    if (!ctx) return null;
    if (typeof ctx.get === "function") {
      try {
        const value = await ctx.get();
        return value?.locale || value?.language || null;
      } catch {
        return null;
      }
    }
    return ctx.locale || ctx.language || null;
  }

  subscribeLocale(listener: (locale: string | null) => void): () => void {
    const app = window.tuttiExternal?.app;
    if (typeof app?.subscribe === "function") {
      return app.subscribe((value) => listener(value?.locale || value?.language || null));
    }

    const ctx = this.legacyContext();
    if (ctx && typeof ctx.subscribe === "function") {
      return ctx.subscribe((value) => listener(value?.locale || value?.language || null));
    }
    return () => {};
  }
}
