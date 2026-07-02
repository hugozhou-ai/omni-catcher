import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import { Store } from "../platform/store.js";
import type { IHostBridgeService } from "./hostBridgeService.js";

export type AppTheme = "light" | "dark";

export interface IThemeService {
  readonly theme: Store<AppTheme>;
  init(): Promise<void>;
}

export const IThemeService = createServiceIdentifier<IThemeService>("themeService");

export class ThemeService implements IThemeService {
  readonly theme = new Store<AppTheme>(this.systemTheme());

  private initialized = false;
  private hostTheme: AppTheme | null = null;

  constructor(private readonly host: IHostBridgeService) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyCurrent = () => this.apply(this.hostTheme || (media.matches ? "dark" : "light"));

    this.hostTheme = this.normalize(await this.host.readTheme());
    applyCurrent();

    this.host.subscribeTheme((theme) => {
      this.hostTheme = this.normalize(theme);
      applyCurrent();
    });

    media.addEventListener("change", () => {
      if (!this.hostTheme) applyCurrent();
    });
  }

  private apply(theme: AppTheme): void {
    document.documentElement.dataset.theme = theme;
    this.theme.set(theme);
  }

  private normalize(value: string | null): AppTheme | null {
    if (value === "dark" || value === "light") return value;
    return null;
  }

  private systemTheme(): AppTheme {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
}
