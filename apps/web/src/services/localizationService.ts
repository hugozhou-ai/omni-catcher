import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import { dictionaries, normalizeLocale, type Locale, type Messages } from "../i18n/index.js";
import { Store } from "../platform/store.js";
import type { IHostBridgeService } from "./hostBridgeService.js";

export interface ILocalizationService {
  readonly locale: Store<Locale>;
  t(key: keyof Messages): string;
  init(): Promise<void>;
}

export const ILocalizationService = createServiceIdentifier<ILocalizationService>("localizationService");

const DEFAULT_LOCALE: Locale = "en";

export class LocalizationService implements ILocalizationService {
  readonly locale = new Store<Locale>(DEFAULT_LOCALE);

  constructor(private readonly host: IHostBridgeService) {}

  t(key: keyof Messages): string {
    return dictionaries[this.locale.get()][key];
  }

  async init(): Promise<void> {
    this.apply((await this.host.readLocale()) || this.browserLocale());
    this.host.subscribeLocale((locale) => {
      this.apply(locale || this.browserLocale());
    });
  }

  private apply(value: string | null): void {
    const next = normalizeLocale(value || DEFAULT_LOCALE);
    document.documentElement.lang = next;
    this.locale.set(next);
  }

  private browserLocale(): string {
    if (document.documentElement.lang) return document.documentElement.lang;
    return window.navigator.languages[0] || window.navigator.language || DEFAULT_LOCALE;
  }
}
