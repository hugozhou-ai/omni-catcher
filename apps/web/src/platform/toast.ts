import { Store } from "./store.js";

export interface ToastMessage {
  id: number;
  text: string;
}

export const toastStore = new Store<ToastMessage | null>(null);

export function showToast(text: string): void {
  toastStore.set({ id: Date.now(), text });
}
