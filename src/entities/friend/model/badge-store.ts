import { create } from "zustand";
import type { FriendRow } from "../api/friends";

/** Friend counts and rows the shell and Friends page need outside the poller. */
type FriendBadgeState = {
  incoming: number;
  online: number;
  /** Latest friendship rows from the app-wide poll; null until the first load. */
  rows: FriendRow[] | null;
  setFromRows: (rows: FriendRow[]) => void;
  reset: () => void;
};

function isOnline(status: string | null | undefined): boolean {
  return status === "online" || status === "in_game" || status === "hosting";
}

export const useFriendBadgeStore = create<FriendBadgeState>((set) => ({
  incoming: 0,
  online: 0,
  rows: null,
  setFromRows: (rows) => {
    let incoming = 0;
    let online = 0;
    for (const r of rows) {
      if (r.direction === "incoming") incoming++;
      else if (r.direction === "friend" && isOnline(r.sessionStatus)) online++;
    }
    set((s) =>
      s.incoming === incoming && s.online === online
        ? { rows }
        : { incoming, online, rows },
    );
  },
  reset: () => set({ incoming: 0, online: 0, rows: null }),
}));
