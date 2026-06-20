import { useService, useStore } from "../platform/react.js";
import { ILocalizationService } from "../services/localizationService.js";
import type { Locale, Messages } from "../i18n/index.js";

export function useTranslation(): { locale: Locale; t: (key: keyof Messages) => string } {
  const localization = useService(ILocalizationService);
  const locale = useStore(localization.locale);
  return { locale, t: (key) => localization.t(key) };
}
