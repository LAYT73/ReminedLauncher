import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { McSelect, type McSelectOption } from "@/shared/ui/McSelect";
import { PixelCrossIcon } from "@/shared/ui/PixelIcons";

type Props = {
  open: boolean;
  busy: boolean;
  lobbyReady: boolean;
  inviteOptions: McSelectOption[];
  invitePick: string;
  setInvitePick: (id: string) => void;
  onInvite: () => Promise<void>;
  onClose: () => void;
};

export function VoiceInviteModal({
  open,
  busy,
  lobbyReady,
  inviteOptions,
  invitePick,
  setInvitePick,
  onInvite,
  onClose,
}: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="voice-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="voice-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="voice-modal-head">
          <h3 id={titleId} className="settings-heading">
            Invite friend
          </h3>
          <button
            type="button"
            className="btn-mc dim btn-icon-sq voice-modal-close"
            title="Close"
            aria-label="Close"
            onClick={onClose}
          >
            <PixelCrossIcon />
          </button>
        </header>

        <McSelect
          className="pack-select--full"
          label="Friend"
          menuPlacement="down"
          disabled={inviteOptions.length === 0 || !lobbyReady || busy}
          placeholder={
            !lobbyReady
              ? "Lobby still opening…"
              : inviteOptions.length === 0
                ? "No friends yet"
                : "Choose a friend…"
          }
          options={inviteOptions}
          value={invitePick}
          onChange={setInvitePick}
        />

        <div className="voice-modal-actions btn-row">
          <button type="button" className="btn-mc dim" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-mc ok"
            disabled={!invitePick || !lobbyReady || busy}
            onClick={() => {
              void onInvite()
                .then(() => onClose())
                .catch(() => undefined);
            }}
          >
            Send invite
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
