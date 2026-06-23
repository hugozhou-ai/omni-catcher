import { useService, useStore } from "../platform/react.js";
import { ILocalizationService } from "../services/localizationService.js";
import type { Messages } from "../i18n/index.js";

export function useTranslation(): {
  t: (key: keyof Messages) => string;
} {
  const localization = useService(ILocalizationService);
  useStore(localization.locale);
  return {
    t: (key) => localization.t(key),
  };
}
