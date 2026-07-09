import type { ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";

export type SelectOption<T extends string | number> = {
  value: T;
  label: string;
};

const EMPTY_VALUE = "__app_select_empty__";

function toRadixValue(value: string): string {
  return value === "" ? EMPTY_VALUE : value;
}

function fromRadixValue(value: string): string {
  return value === EMPTY_VALUE ? "" : value;
}

export function Select<T extends string | number>(props: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  label?: string;
  compact?: boolean;
  inline?: boolean;
  className?: string;
  disabled?: boolean;
  stopPropagation?: boolean;
}): ReactNode {
  const {
    value,
    options,
    onChange,
    label,
    compact = false,
    inline = false,
    className,
    disabled = false,
    stopPropagation = false,
  } = props;

  const classes = ["app-select", compact ? "compact" : "", inline ? "inline" : "", className]
    .filter(Boolean)
    .join(" ");
  const stringValue = String(value);
  const selected = options.find((option) => String(option.value) === stringValue);

  return (
    <div
      className={classes}
      onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
      onPointerDown={stopPropagation ? (event) => event.stopPropagation() : undefined}
    >
      {label ? <span className="app-select-label">{label}</span> : null}
      <SelectPrimitive.Root
        value={toRadixValue(stringValue)}
        disabled={disabled}
        onValueChange={(next) => {
          const decoded = fromRadixValue(next);
          const match = options.find((option) => String(option.value) === decoded);
          if (match) onChange(match.value);
        }}
      >
        <SelectPrimitive.Trigger className="app-select-trigger" aria-label={label}>
          <SelectPrimitive.Value placeholder={selected?.label ?? stringValue}>
            {selected?.label ?? stringValue}
          </SelectPrimitive.Value>
          <SelectPrimitive.Icon asChild>
            <span className="app-select-chevron" aria-hidden="true" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content className="app-select-content scroll-thin" position="popper" sideOffset={6}>
            <SelectPrimitive.Viewport>
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={String(option.value)}
                  className="app-select-item"
                  value={toRadixValue(String(option.value))}
                >
                  <SelectPrimitive.ItemIndicator className="app-select-item-indicator">
                    ✓
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}
