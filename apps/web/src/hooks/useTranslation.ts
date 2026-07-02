import { useCallback } from "react";
import { useService, useStore } from "../platform/react.js";
import { ILocalizationService } from "../services/localizationService.js";
import type { Messages } from "../i18n/index.js";

export function useTranslation(): {
  t: (key: keyof Messages) => string;
} {
  const localization = useService(ILocalizationService);
  const locale = useStore(localization.locale);
  const t = useCallback((key: keyof Messages) => localization.t(key), [localization, locale]);
  return {
    t,
  };
}
