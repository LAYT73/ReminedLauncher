import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/shared/i18n";
import { SkinHead } from "@/entities/skin";
import { McSelect, type McSelectOption } from "@/shared/ui/McSelect";
import { PixelCrossIcon } from "@/shared/ui/PixelIcons";

/** Friend option; skinUrl drives the face icon in the picker. */
export type InviteOption = McSelectOption & { skinUrl: string | null };

type Props = {
  open: boolean;
  busy: boolean;
  lobbyReady: boolean;
  inviteOptions: InviteOption[];
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
  const t = useT();
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
            {t("voice.inviteFriend")}
          </h3>
          <button
            type="button"
            className="btn-mc dim btn-icon-sq voice-modal-close"
            title={t("voice.close")}
            aria-label={t("voice.close")}
            onClick={onClose}
          >
            <PixelCrossIcon />
          </button>
        </header>

        <McSelect
          className="pack-select--full"
          label={t("voice.inviteModal.friend")}
          menuPlacement="down"
          disabled={inviteOptions.length === 0 || !lobbyReady || busy}
          placeholder={
            !lobbyReady
              ? t("voice.lobbyOpening")
              : inviteOptions.length === 0
                ? t("voice.inviteModal.none")
                : t("voice.inviteModal.choose")
          }
          options={inviteOptions}
          renderIcon={(opt, size) => (
            <SkinHead skinUrl={opt.skinUrl} className="pack-select-skin" size={size} />
          )}
          value={invitePick}
          onChange={setInvitePick}
        />

        <div className="voice-modal-actions btn-row">
          <button type="button" className="btn-mc dim" onClick={onClose}>
            {t("voice.cancel")}
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
            {t("voice.inviteModal.send")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
