import { useCallback, useEffect, useState } from "react";
import { listFriendships, useFriendBadgeStore, type FriendRow } from "@/entities/friend";
import { MSG } from "@/shared/config/messages";

export function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return MSG.common.somethingWentWrong;
}

const NO_ROWS: FriendRow[] = [];

/**
 * Friendship rows from the shared store (kept fresh by the app-wide poller)
 * plus load/error state. Mount and action refreshes write into the same store.
 */
export function useFriends(userId: string) {
  const sharedRows = useFriendBadgeStore((s) => s.rows);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  const rows = sharedRows ?? NO_ROWS;
  const loading = sharedRows === null && fetching;

  const refresh = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!opts?.quiet) {
        setFetching(true);
        setError("");
      }
      try {
        const next = await listFriendships(userId);
        useFriendBadgeStore.getState().setFromRows(next);
      } catch (err) {
        if (!opts?.quiet) setError(errText(err));
      } finally {
        if (!opts?.quiet) setFetching(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, loading, error, setError, refresh };
}
