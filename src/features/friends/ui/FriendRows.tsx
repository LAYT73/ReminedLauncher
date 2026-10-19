import { canJoinFriend, type FriendRow } from "@/entities/friend";
import { SkinHead } from "@/entities/skin";
import { MSG } from "@/shared/config/messages";
import { presenceLabel } from "../lib/presenceLabel";

type ToastFn = (message: string) => void;

/** Avatar + name + (copyable or static) Remined id. */
function Identity({
  row,
  onToast,
}: {
  row: FriendRow;
  /** Omit for a static, non-copyable id. */
  onToast?: ToastFn;
}) {
  return (
    <>
      <SkinHead
        skinUrl={row.profile.skin_path}
        className="friend-avatar"
        size={40}
      />
      <div className="friend-copy">
        <strong>{row.profile.username}</strong>
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
      <Identity row={row} onToast={onToast} />
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
      <span
        className={`friend-status is-${row.sessionStatus ?? "offline"}`}
        title={presenceLabel(row)}
      >
        {presenceLabel(row)}
      </span>
    </li>
  );
}

export function OutgoingRow({ row, onCancel }: { row: FriendRow; onCancel: () => void }) {
  return (
    <li className="friend-row">
      <Identity row={row} />
      <button type="button" className="btn-mc danger" onClick={onCancel}>
        Cancel
      </button>
      <span className="friend-status">Pending</span>
    </li>
  );
}
