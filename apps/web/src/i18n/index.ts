import type { Locale, Messages } from "./messages.js";
import { en } from "./en.js";
import { zhCN } from "./zh-CN.js";

export type { Locale, Messages } from "./messages.js";
export { normalizeLocale } from "./messages.js";

export const dictionaries: Record<Locale, Messages> = {
  en,
  "zh-CN": zhCN,
};
