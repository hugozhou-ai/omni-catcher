export function formatRelativeTime(
  iso: string | undefined,
  t: (key: "relativeJustNow" | "relativeMinutes" | "relativeHours" | "relativeDays") => string,
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return t("relativeJustNow");
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return t("relativeMinutes").replace("{n}", String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t("relativeHours").replace("{n}", String(hours));
  const days = Math.floor(hours / 24);
  if (days < 30) return t("relativeDays").replace("{n}", String(days));
  return iso.slice(0, 10);
}

export function formatItemCount(count: number, template: string): string {
  return template.replace("{n}", String(count));
}
