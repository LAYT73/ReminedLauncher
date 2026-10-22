import { useState } from "react";
import {
  removeFriendship,
  respondFriendRequest,
  sendFriendRequest,
  type FriendRow,
} from "@/entities/friend";
import { useT } from "@/shared/i18n";
import { InfoNote } from "@/shared/ui/InfoNote";
import { TitleHint } from "@/shared/ui/TitleHint";
import { errText, useFriends } from "../model/useFriends";
import { FriendItem, OutgoingRow, RequestRow } from "./FriendRows";
import { FriendsSkeletonList } from "./FriendsSkeletonList";
import { EmptyState } from "@/shared/ui/EmptyState";

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
  const t = useT();
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
      onToast(t("social.friends.requestSent"));
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
        title={t("social.friends.title")}
        hint={
          <>
            {t("social.friends.hintBase")}
            {myReminedId ? (
              <>
                {" "}
                — {t("social.friends.hintYours")}{" "}
                <span className="friends-id-inline">#{myReminedId}</span>
              </>
            ) : null}
            .
          </>
        }
      />

      <InfoNote id="friends.play-together">
        <p>
          {t("social.friends.playA")}{" "}
          <strong>{t("social.friends.playLan")}</strong>{" "}
          {t("social.friends.playB")}{" "}
          <strong>{t("social.friends.playJoin")}</strong>
          {t("social.friends.playC")}{" "}
          {onOpenNetworkPlay ? (
            <button
              type="button"
              className="friends-inline-link"
              onClick={() => onOpenNetworkPlay()}
            >
              {t("social.friends.networkPlay")}
            </button>
          ) : (
            t("social.friends.networkPlay")
          )}
          .
        </p>
      </InfoNote>

      {hostingSelf ? (
        <p className="friends-hosting-banner" role="status">
          {t("social.friends.hostingBanner")}
        </p>
      ) : null}

      <form className="friends-add" onSubmit={(e) => void onAdd(e)}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("social.friends.idPlaceholder")}
          maxLength={8}
          spellCheck={false}
          aria-label={t("social.friends.idLabel")}
        />
        <button
          type="submit"
          className="btn-mc ok"
          disabled={busy || !query.trim()}
        >
          {busy ? t("social.friends.sending") : t("social.friends.add")}
        </button>
      </form>

      {error ? <p className="friends-error">{error}</p> : null}

      {loading ? (
        <div className="friends-block">
          <h3 className="settings-heading">{t("social.friends.onlineCircle")}</h3>
          <FriendsSkeletonList />
        </div>
      ) : (
        <>
          {incoming.length > 0 ? (
            <div className="friends-block">
              <h3 className="settings-heading">{t("social.friends.requests")}</h3>
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
            <h3 className="settings-heading">{t("social.friends.onlineCircle")}</h3>
            {friends.length === 0 ? (
              <EmptyState
                kind="friends"
                title={t("social.friends.emptyTitle")}
                description={t("social.friends.emptyHint")}
              />
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
              <h3 className="settings-heading">{t("social.friends.outgoing")}</h3>
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
