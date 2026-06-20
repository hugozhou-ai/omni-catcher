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

export class LocalizationService implements ILocalizationService {
  readonly locale = new Store<Locale>(normalizeLocale(navigator.language));

  constructor(private readonly host: IHostBridgeService) {}

  t(key: keyof Messages): string {
    return dictionaries[this.locale.get()][key];
  }

  async init(): Promise<void> {
    const hostLocale = await this.host.readLocale().catch(() => null);
    this.apply(hostLocale);
    this.host.subscribeLocale((value) => this.apply(value));
  }

  private apply(value: string | null): void {
    const next = normalizeLocale(value || navigator.language);
    document.documentElement.lang = next;
    this.locale.set(next);
  }
}
