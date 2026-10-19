import { create } from "zustand";

export type ToastTone = "default" | "ok" | "err";

type ToastState = {
  message: string | null;
  tone: ToastTone;
  show: (message: string, tone?: ToastTone) => void;
  dismiss: () => void;
};

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  tone: "default",
  show: (message, tone = "default") => set({ message, tone }),
  dismiss: () => set({ message: null, tone: "default" }),
}));

/** Show a toast from anywhere (components, stores, actions). */
export function toast(message: string, tone: ToastTone = "default"): void {
  useToastStore.getState().show(message, tone);
}
