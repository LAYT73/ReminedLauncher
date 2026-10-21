import { useCallback, useEffect, useState } from "react";
import { listFriendships, type FriendRow } from "@/entities/friend";
import { TIMING } from "@/shared/config/timings";
import { MSG } from "@/shared/config/messages";

export function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return MSG.common.somethingWentWrong;
}

/** Friendship rows (polled quietly) plus load/error state. */
export function useFriends(userId: string) {
  const [rows, setRows] = useState<FriendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!opts?.quiet) {
        setLoading(true);
        setError("");
      }
      try {
        setRows(await listFriendships(userId));
      } catch (err) {
        if (!opts?.quiet) setError(errText(err));
      } finally {
        if (!opts?.quiet) setLoading(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    void refresh();
    const id = window.setInterval(
      () => void refresh({ quiet: true }),
      TIMING.friendsPoll,
    );
    return () => window.clearInterval(id);
  }, [refresh]);

  return { rows, loading, error, setError, refresh };
}
