import { create } from "zustand";

interface IconState {
  /** Icon key (item / block name) -> data URL. Filled in the background by the icon pipeline. */
  icons: Record<string, string>;
}

export const useIconStore = create<IconState>(() => ({ icons: {} }));

/** Synchronous icon lookup (null until the pipeline has produced it). */
export function useIcon(key: string | null): string | null {
  return useIconStore((s) => (key ? (s.icons[key] ?? null) : null));
}
