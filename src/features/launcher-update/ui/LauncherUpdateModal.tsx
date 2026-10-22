import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { PixelCrossIcon } from "@/shared/ui/PixelIcons";
import { useT } from "@/shared/i18n";
import { useProfileStore } from "@/entities/profile";
import { useLauncherUpdate } from "../model/store";

const SPLIT = "\u0000";

/** Startup modal: update available — install now or later. */
export function LauncherUpdateModal() {
  const t = useT();
  const titleId = useId();
  const appVersion = useProfileStore((s) => s.appVersion);
  const pending = useLauncherUpdate((s) => s.pending);
  const busy = useLauncherUpdate((s) => s.busy);
  const promptOpen = useLauncherUpdate((s) => s.promptOpen);
  const installPending = useLauncherUpdate((s) => s.installPending);
  const closePrompt = useLauncherUpdate((s) => s.closePrompt);

  const open = promptOpen && Boolean(pending);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) closePrompt();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy, closePrompt]);

  if (!open || !pending) return null;

  const [readyPre, readyPost] = t("settings.update.modal.ready", { v: SPLIT }).split(SPLIT);
  const [havePre, havePost] = t("settings.update.modal.youHave", { v: SPLIT }).split(SPLIT);

  return createPortal(
    <div
      className="voice-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) closePrompt();
      }}
    >
      <div
        className="voice-modal launcher-update-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="voice-modal-head">
          <h3 id={titleId} className="settings-heading">
            {t("settings.update.modal.title")}
          </h3>
          <button
            type="button"
            className="btn-mc dim btn-icon-sq voice-modal-close"
            title={t("common.close")}
            aria-label={t("common.close")}
            disabled={busy}
            onClick={() => closePrompt()}
          >
            <PixelCrossIcon />
          </button>
        </header>

        <p className="friends-lead launcher-update-modal-copy">
          {readyPre}
          <strong>{pending.version}</strong>
          {readyPost}
          {appVersion ? (
            <>
              {" "}
              {havePre}
              <span className="settings-value">{appVersion}</span>
              {havePost}
            </>
          ) : null}
          . {t("settings.update.modal.hint")}
        </p>

        {pending.notes ? (
          <pre className="launcher-update-notes">{pending.notes}</pre>
        ) : null}

        <div className="voice-modal-actions">
          <button
            type="button"
            className="btn-mc dim"
            disabled={busy}
            onClick={() => closePrompt()}
          >
            {t("settings.update.modal.later")}
          </button>
          <button
            type="button"
            className="btn-mc ok"
            disabled={busy}
            onClick={() => void installPending()}
          >
            {busy
              ? t("settings.update.modal.downloading")
              : t("settings.update.modal.updateNow")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
