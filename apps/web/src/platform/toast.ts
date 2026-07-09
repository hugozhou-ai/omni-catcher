import { Store } from "./store.js";

export type ToastVariant = "success" | "error" | "info";

export interface ToastMessage {
  id: number;
  text: string;
  variant: ToastVariant;
}

export const toastStore = new Store<ToastMessage[]>([]);

const MAX_TOASTS = 2;

export function showToast(text: string, variant: ToastVariant = "success"): void {
  const next: ToastMessage = { id: Date.now() + Math.random(), text, variant };
  const current = toastStore.get();
  toastStore.set([next, ...current].slice(0, MAX_TOASTS));
}

export function dismissToast(id: number): void {
  toastStore.set(toastStore.get().filter((item) => item.id !== id));
}
