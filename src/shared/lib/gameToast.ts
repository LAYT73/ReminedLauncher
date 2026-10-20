import { create } from "zustand";

export type GameToastPayload = {
  title: string;
  body?: string;
};

type GameToastState = {
  payload: GameToastPayload | null;
  show: (payload: GameToastPayload) => void;
  dismiss: () => void;
};

export const useGameToastStore = create<GameToastState>((set) => ({
  payload: null,
  show: (payload) => set({ payload }),
  dismiss: () => set({ payload: null }),
}));

/** Steam-style bottom-left toast (custom UI, not OS notifications). */
export function gameToast(title: string, body?: string): void {
  useGameToastStore.getState().show({ title, body });
}
