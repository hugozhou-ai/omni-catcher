export function toRadixSelectValue(value: string | number): string {
  if (typeof value === "string") return `s:${JSON.stringify(value)}`;
  if (Number.isNaN(value)) return "n:NaN";
  if (Object.is(value, -0)) return "n:-0";
  if (value === Number.POSITIVE_INFINITY) return "n:Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "n:-Infinity";
  return `n:${String(value)}`;
}

export function findSelectOptionByRadixValue<
  T extends string | number,
  O extends { value: T },
>(options: readonly O[], radixValue: string): O | undefined {
  return options.find((option) => toRadixSelectValue(option.value) === radixValue);
}
