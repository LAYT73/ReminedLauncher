import { useState } from "react";
import {
  removeFriendship,
  respondFriendRequest,
  sendFriendRequest,
  type FriendRow,
} from "@/entities/friend";
import { InfoNote } from "@/shared/ui/InfoNote";
import { TitleHint } from "@/shared/ui/TitleHint";
import { errText, useFriends } from "../model/useFriends";
import { FriendItem, OutgoingRow, RequestRow } from "./FriendRows";
import { FriendsSkeletonList } from "./FriendsSkeletonList";

type Props = {
  userId: string;
  myReminedId: string | null;
  onToast: (msg: string) => void;
  onJoinFriend: (row: FriendRow) => void;
  joiningFriendId?: string | null;
  hostingSelf?: boolean;
  onOpenNetworkPlay?: () => void;
};

export function FriendsPanel({
  userId,
  myReminedId,
  onToast,
  onJoinFriend,
  joiningFriendId,
  hostingSelf,
  onOpenNetworkPlay,
}: Props) {
  const { rows, loading, error, setError, refresh } = useFriends(userId);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

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
  const respond = (row: FriendRow, accept: boolean) =>
    void respondFriendRequest(row.friendshipId, accept).then(() => refresh());
  const remove = (row: FriendRow) =>
    void removeFriendship(row.friendshipId).then(() => refresh());

  return (
    <section className="section friends-panel">
      <TitleHint
        title="Friends"
        hint={
          <>
            Add people by their Remined id
            {myReminedId ? (
              <>
                {" "}
                — yours is{" "}
                <span className="friends-id-inline">#{myReminedId}</span>
              </>
            ) : null}
            .
          </>
        }
      />

      <InfoNote id="friends.play-together">
        <p>
          To play together: host{" "}
          <strong>Open to LAN</strong> → friends hit <strong>Join</strong>.
          Setup lives under{" "}
          {onOpenNetworkPlay ? (
            <button
              type="button"
              className="friends-inline-link"
              onClick={() => onOpenNetworkPlay()}
            >
              Network Play
            </button>
          ) : (
            "Network Play"
          )}
          .
        </p>
      </InfoNote>

      {hostingSelf ? (
        <p className="friends-hosting-banner" role="status">
          You are hosting — friends can Join your LAN world now.
        </p>
      ) : null}

      <form className="friends-add" onSubmit={(e) => void onAdd(e)}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. a7k2m9p"
          maxLength={8}
          spellCheck={false}
          aria-label="Friend Remined id"
        />
        <button
          type="submit"
          className="btn-mc ok"
          disabled={busy || !query.trim()}
        >
          {busy ? "Sending…" : "Add friend"}
        </button>
      </form>

      {error ? <p className="friends-error">{error}</p> : null}

      {loading ? (
        <div className="friends-block">
          <h3 className="settings-heading">Online circle</h3>
          <FriendsSkeletonList />
        </div>
      ) : (
        <>
          {incoming.length > 0 ? (
            <div className="friends-block">
              <h3 className="settings-heading">Requests</h3>
              <ul className="friends-list">
                {incoming.map((row) => (
                  <RequestRow
                    key={row.friendshipId}
                    row={row}
                    onToast={onToast}
                    onRespond={(accept) => respond(row, accept)}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          <div className="friends-block">
            <h3 className="settings-heading">Online circle</h3>
            {friends.length === 0 ? (
              <p className="friends-muted">No friends yet — send an id above.</p>
            ) : (
              <ul className="friends-list">
                {friends.map((row) => (
                  <FriendItem
                    key={row.friendshipId}
                    row={row}
                    joiningFriendId={joiningFriendId}
                    onToast={onToast}
                    onJoin={onJoinFriend}
                    onRemove={() => remove(row)}
                  />
                ))}
              </ul>
            )}
          </div>

          {outgoing.length > 0 ? (
            <div className="friends-block">
              <h3 className="settings-heading">Outgoing</h3>
              <ul className="friends-list">
                {outgoing.map((row) => (
                  <OutgoingRow key={row.friendshipId} row={row} onCancel={() => remove(row)} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
