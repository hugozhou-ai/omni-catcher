import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

export function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
}): ReactNode {
  const {
    open,
    onOpenChange,
    title,
    description,
    confirmLabel,
    cancelLabel,
    danger = false,
    busy = false,
    onConfirm,
  } = props;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="app-dialog-overlay" />
        <DialogPrimitive.Content className="app-dialog-content" aria-describedby={undefined}>
          <DialogPrimitive.Title className="app-dialog-title">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="app-dialog-description">
            {description}
          </DialogPrimitive.Description>
          <div className="app-dialog-actions">
            <button type="button" disabled={busy} onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </button>
            <button
              type="button"
              className={danger ? "danger" : "primary"}
              disabled={busy}
              onClick={() => void onConfirm()}
            >
              {confirmLabel}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
