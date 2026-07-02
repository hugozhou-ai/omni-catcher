import { createServiceIdentifier } from "@omni-catcher/shared/platform";

type TuttiHostContext = {
  locale?: string;
  language?: string;
  theme?: string;
  colorScheme?: string;
  colorMode?: string;
  appearance?: string;
  mode?: string;
};

interface TuttiAppContext {
  get?(): Promise<TuttiHostContext>;
  subscribe?(listener: (context: TuttiHostContext) => void): () => void;
  locale?: string;
  language?: string;
  theme?: string;
  colorScheme?: string;
  colorMode?: string;
  appearance?: string;
  mode?: string;
}

interface TuttiExternalAppContext {
  getContext?(): Promise<TuttiHostContext>;
  subscribe?(listener: (context: TuttiHostContext) => void): () => void;
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
  readTheme(): Promise<string | null>;
  subscribeTheme(listener: (theme: string | null) => void): () => void;
}

export const IHostBridgeService = createServiceIdentifier<IHostBridgeService>("hostBridgeService");

export class HostBridgeService implements IHostBridgeService {
  private legacyContext(): TuttiAppContext | undefined {
    return window.tutti?.appContext || window.tuttiAppContext;
  }

  private async readContext(): Promise<TuttiHostContext | null> {
    const app = window.tuttiExternal?.app;
    if (typeof app?.getContext === "function") {
      try {
        return (await app.getContext()) || null;
      } catch {
        return null;
      }
    }

    const ctx = this.legacyContext();
    if (!ctx) return null;
    if (typeof ctx.get === "function") {
      try {
        return (await ctx.get()) || null;
      } catch {
        return null;
      }
    }
    return ctx;
  }

  async readLocale(): Promise<string | null> {
    const value = await this.readContext();
    return value?.locale || value?.language || null;
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

  async readTheme(): Promise<string | null> {
    return this.themeFromContext(await this.readContext());
  }

  subscribeTheme(listener: (theme: string | null) => void): () => void {
    const app = window.tuttiExternal?.app;
    if (typeof app?.subscribe === "function") {
      return app.subscribe((value) => {
        const theme = this.themeFromSubscribedContext(value);
        if (theme !== undefined) listener(theme);
      });
    }

    const ctx = this.legacyContext();
    if (ctx && typeof ctx.subscribe === "function") {
      return ctx.subscribe((value) => {
        const theme = this.themeFromSubscribedContext(value);
        if (theme !== undefined) listener(theme);
      });
    }
    return () => {};
  }

  private themeFromContext(value: TuttiHostContext | null | undefined): string | null {
    const raw =
      value?.theme || value?.colorScheme || value?.colorMode || value?.appearance || value?.mode;
    if (!raw) return null;
    const normalized = raw.toLowerCase();
    if (normalized.includes("dark")) return "dark";
    if (normalized.includes("light")) return "light";
    return null;
  }

  private themeFromSubscribedContext(value: TuttiHostContext | null | undefined): string | null | undefined {
    if (
      !value ||
      !("theme" in value || "colorScheme" in value || "colorMode" in value || "appearance" in value || "mode" in value)
    ) {
      return undefined;
    }
    return this.themeFromContext(value);
  }
}
