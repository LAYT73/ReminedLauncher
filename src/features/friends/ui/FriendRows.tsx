import type { ReactNode } from "react";
import { canJoinFriend, PresenceBadge, type FriendRow } from "@/entities/friend";
import { MSG } from "@/shared/config/messages";
import { useT } from "@/shared/i18n";
import { StatusBadge as SharedBadge } from "@/shared/ui/StatusBadge";
import { FriendSkinPeek } from "./FriendSkinPeek";
import { FriendPartyButton } from "./FriendPartyButton";

type ToastFn = (message: string) => void;

function StatusBadge({
  row,
  fallback,
}: {
  row?: FriendRow;
  /** Static label when not a live friend session (e.g. Pending). */
  fallback?: string;
}) {
  if (fallback) {
    return (
      <SharedBadge tone="pending" title={fallback}>
        <span className="friend-status-kind">{fallback}</span>
      </SharedBadge>
    );
  }
  return row ? <PresenceBadge row={row} /> : null;
}

/** Avatar + name (+ status badge) + (copyable or static) Remined id. */
function Identity({
  row,
  onToast,
  status,
}: {
  row: FriendRow;
  /** Omit for a static, non-copyable id. */
  onToast?: ToastFn;
  status?: ReactNode;
}) {
  return (
    <>
      <FriendSkinPeek profile={row.profile} />
      <div className="friend-copy">
        <div className="friend-name-row">
          <strong className="friend-nick">{row.profile.username}</strong>
          {status}
        </div>
        {onToast ? (
          <button
            type="button"
            className="friend-id"
            onClick={() => {
              void navigator.clipboard.writeText(row.profile.remined_id);
              onToast(MSG.profile.copiedId);
            }}
          >
            #{row.profile.remined_id}
          </button>
        ) : (
          <span className="friend-id-static">#{row.profile.remined_id}</span>
        )}
      </div>
    </>
  );
}

export function RequestRow({
  row,
  onToast,
  onRespond,
}: {
  row: FriendRow;
  onToast: ToastFn;
  onRespond: (accept: boolean) => void;
}) {
  const t = useT();
  return (
    <li className="friend-row">
      <Identity row={row} onToast={onToast} />
      <div className="friend-actions">
        <button type="button" className="btn-mc ok" onClick={() => onRespond(true)}>
          {t("social.friends.accept")}
        </button>
        <button type="button" className="btn-mc dim" onClick={() => onRespond(false)}>
          {t("social.friends.decline")}
        </button>
      </div>
    </li>
  );
}

export function FriendItem({
  row,
  joiningFriendId,
  onToast,
  onJoin,
  onRemove,
}: {
  row: FriendRow;
  joiningFriendId?: string | null;
  onToast: ToastFn;
  onJoin: (row: FriendRow) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const joining = joiningFriendId === row.friendshipId;
  return (
    <li className="friend-row has-join">
      <Identity
        row={row}
        onToast={onToast}
        status={<StatusBadge row={row} />}
      />
      <div className="friend-join-group">
        {canJoinFriend(row) ? (
          <button
            type="button"
            className="btn-mc ok friend-join"
            disabled={Boolean(joiningFriendId)}
            onClick={() => onJoin(row)}
          >
            {joining ? t("social.friends.joining") : t("social.friends.join")}
          </button>
        ) : null}
        <FriendPartyButton row={row} onToast={onToast} />
      </div>
      <button type="button" className="btn-mc danger friend-remove" onClick={onRemove}>
        {t("social.friends.remove")}
      </button>
    </li>
  );
}

export function OutgoingRow({ row, onCancel }: { row: FriendRow; onCancel: () => void }) {
  const t = useT();
  return (
    <li className="friend-row">
      <Identity row={row} status={<StatusBadge fallback={t("social.friends.pending")} />} />
      <button type="button" className="btn-mc danger" onClick={onCancel}>
        {t("social.friends.cancel")}
      </button>
    </li>
  );
}
