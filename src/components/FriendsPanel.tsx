import { useCallback, useEffect, useState } from "react";
import {
  listFriendships,
  removeFriendship,
  respondFriendRequest,
  sendFriendRequest,
  type FriendRow,
} from "../lib/friends";
import { SkinHead } from "./SkinHead";

type Props = {
  userId: string;
  myReminedId: string | null;
  onToast: (msg: string) => void;
};

export function FriendsPanel({ userId, myReminedId, onToast }: Props) {
  const [rows, setRows] = useState<FriendRow[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function errText(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (err && typeof err === "object" && "message" in err) {
      const m = (err as { message?: unknown }).message;
      if (typeof m === "string" && m.trim()) return m;
    }
    return "Something went wrong";
  }

  const refresh = useCallback(async (opts?: { quiet?: boolean }) => {
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
  }, [userId]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh({ quiet: true });
    }, 12_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  function presenceLabel(row: FriendRow): string {
    const st = row.sessionStatus ?? "offline";
    if (st === "in_game" || st === "hosting") {
      const pack = row.sessionPackName?.trim();
      if (pack) return st === "hosting" ? `Hosting ${pack}` : `Playing ${pack}`;
      return st === "hosting" ? "Hosting" : "In game";
    }
    if (st === "online") return "Online";
    return "Offline";
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await sendFriendRequest(userId, query);
      setQuery("");
      onToast("Request sent");
      await refresh();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const incoming = rows.filter((r) => r.direction === "incoming");
  const friends = rows.filter((r) => r.direction === "friend");
  const outgoing = rows.filter((r) => r.direction === "outgoing");

  return (
    <section className="section friends-panel">
      <h2 className="page-title">Friends</h2>
      <p className="friends-lead">
        Add people by their Remined id
        {myReminedId ? (
          <>
            {" "}
            — yours is <span className="friends-id-inline">#{myReminedId}</span>
          </>
        ) : null}
        .
      </p>

      <form className="friends-add" onSubmit={(e) => void onAdd(e)}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. a7k2m9p"
          maxLength={8}
          spellCheck={false}
          aria-label="Friend Remined id"
        />
        <button type="submit" className="btn-mc" disabled={busy || !query.trim()}>
          {busy ? "Sending…" : "Add friend"}
        </button>
      </form>

      {error ? <p className="friends-error">{error}</p> : null}
      {loading ? <p className="friends-muted">Loading…</p> : null}

      {incoming.length > 0 ? (
        <div className="friends-block">
          <h3 className="settings-heading">Requests</h3>
          <ul className="friends-list">
            {incoming.map((row) => (
              <li key={row.friendshipId} className="friend-row">
                <SkinHead
                  skinUrl={row.profile.skin_path}
                  className="friend-avatar"
                  size={40}
                />
                <div className="friend-copy">
                  <strong>{row.profile.username}</strong>
                  <button
                    type="button"
                    className="friend-id"
                    onClick={() => {
                      void navigator.clipboard.writeText(row.profile.remined_id);
                      onToast("Copied Remined id");
                    }}
                  >
                    #{row.profile.remined_id}
                  </button>
                </div>
                <div className="friend-actions">
                  <button
                    type="button"
                    className="btn-mc"
                    onClick={() =>
                      void respondFriendRequest(row.friendshipId, true).then(refresh)
                    }
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="btn-mc dim"
                    onClick={() =>
                      void respondFriendRequest(row.friendshipId, false).then(refresh)
                    }
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="friends-block">
        <h3 className="settings-heading">Online circle</h3>
        {friends.length === 0 && !loading ? (
          <p className="friends-muted">No friends yet — send an id above.</p>
        ) : (
          <ul className="friends-list">
            {friends.map((row) => (
              <li key={row.friendshipId} className="friend-row">
                <SkinHead
                  skinUrl={row.profile.skin_path}
                  className="friend-avatar"
                  size={40}
                />
                <div className="friend-copy">
                  <strong>{row.profile.username}</strong>
                  <button
                    type="button"
                    className="friend-id"
                    onClick={() => {
                      void navigator.clipboard.writeText(row.profile.remined_id);
                      onToast("Copied Remined id");
                    }}
                  >
                    #{row.profile.remined_id}
                  </button>
                </div>
                <span
                  className={`friend-status is-${row.sessionStatus ?? "offline"}`}
                  title={presenceLabel(row)}
                >
                  {presenceLabel(row)}
                </span>
                <button
                  type="button"
                  className="btn-mc dim friend-remove"
                  onClick={() =>
                    void removeFriendship(row.friendshipId).then(refresh)
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {outgoing.length > 0 ? (
        <div className="friends-block">
          <h3 className="settings-heading">Outgoing</h3>
          <ul className="friends-list">
            {outgoing.map((row) => (
              <li key={row.friendshipId} className="friend-row">
                <SkinHead
                  skinUrl={row.profile.skin_path}
                  className="friend-avatar"
                  size={40}
                />
                <div className="friend-copy">
                  <strong>{row.profile.username}</strong>
                  <span className="friend-id-static">#{row.profile.remined_id}</span>
                </div>
                <span className="friend-status">Pending</span>
                <button
                  type="button"
                  className="btn-mc dim"
                  onClick={() =>
                    void removeFriendship(row.friendshipId).then(refresh)
                  }
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
