import { useEffect, useRef, useState, type ReactNode } from "react";

export type SelectOption<T extends string | number> = {
  value: T;
  label: string;
};

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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const classes = ["app-select", compact ? "compact" : "", inline ? "inline" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={rootRef} className={classes}>
      {label ? <span className="app-select-label">{label}</span> : null}
      <button
        type="button"
        className="app-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => {
          if (stopPropagation) event.stopPropagation();
          if (!disabled) setOpen((current) => !current);
        }}
      >
        {selected?.label ?? String(value)}
        <span className="app-select-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="app-select-menu" role="listbox">
          {options.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              className={option.value === value ? "active" : ""}
              role="option"
              aria-selected={option.value === value}
              onClick={(event) => {
                if (stopPropagation) event.stopPropagation();
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.value === value ? <span aria-hidden="true">✓</span> : <span aria-hidden="true" />}
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
