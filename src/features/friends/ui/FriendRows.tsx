import type { ReactNode } from "react";
import { canJoinFriend, type FriendRow } from "@/entities/friend";
import { SkinHead } from "@/entities/skin";
import { MSG } from "@/shared/config/messages";
import { presenceBadge } from "../lib/presenceLabel";

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
      <span className="friend-status-badge is-pending" title={fallback}>
        <span className="friend-status-kind">{fallback}</span>
      </span>
    );
  }
  if (!row) return null;
  const p = presenceBadge(row);
  return (
    <span
      className={`friend-status-badge is-${p.status}`}
      title={p.title}
      aria-label={p.title}
    >
      <span className="friend-status-kind">{p.kind}</span>
      {p.detail ? (
        <span className="friend-status-detail">{p.detail}</span>
      ) : null}
      {p.voice ? <span className="friend-status-voice">voice</span> : null}
    </span>
  );
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
      <SkinHead
        skinUrl={row.profile.skin_path}
        className="friend-avatar"
        size={40}
      />
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
  return (
    <li className="friend-row">
      <Identity row={row} onToast={onToast} />
      <div className="friend-actions">
        <button type="button" className="btn-mc ok" onClick={() => onRespond(true)}>
          Accept
        </button>
        <button type="button" className="btn-mc dim" onClick={() => onRespond(false)}>
          Decline
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
  const joining = joiningFriendId === row.friendshipId;
  return (
    <li className="friend-row has-join">
      <Identity
        row={row}
        onToast={onToast}
        status={<StatusBadge row={row} />}
      />
      {canJoinFriend(row) ? (
        <button
          type="button"
          className="btn-mc ok friend-join"
          disabled={Boolean(joiningFriendId)}
          onClick={() => onJoin(row)}
        >
          {joining ? "Joining…" : "Join"}
        </button>
      ) : (
        <span className="friend-join-slot" aria-hidden />
      )}
      <button type="button" className="btn-mc danger friend-remove" onClick={onRemove}>
        Remove
      </button>
    </li>
  );
}

export function OutgoingRow({ row, onCancel }: { row: FriendRow; onCancel: () => void }) {
  return (
    <li className="friend-row">
      <Identity row={row} status={<StatusBadge fallback="Pending" />} />
      <button type="button" className="btn-mc danger" onClick={onCancel}>
        Cancel
      </button>
    </li>
  );
}
