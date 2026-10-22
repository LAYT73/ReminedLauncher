import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t as tr, useT } from "@/shared/i18n";
import { voiceLogPath, voiceRevealLog } from "../api/voiceNative";
import { PixelCrossIcon } from "@/shared/ui/PixelIcons";
import { PixelProgress } from "@/shared/ui/PixelProgress";

export type VoiceRuntimeModalState = {
  open: boolean;
  phase: string;
  message: string;
  percent: number;
  error: string | null;
};

type Props = {
  state: VoiceRuntimeModalState;
  onClose: () => void;
  onRetry?: () => void;
};

export function VoiceRuntimeModal({ state, onClose, onRetry }: Props) {
  const t = useT();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [logPath, setLogPath] = useState("");

  useEffect(() => {
    if (!state.open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state.error) onClose();
    };
    window.addEventListener("keydown", onKey);
    void voiceLogPath()
      .then(setLogPath)
      .catch(() => setLogPath(""));
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [state.open, state.error, onClose]);

  if (!state.open) return null;

  const busy = !state.error;

  return createPortal(
    <div className="voice-modal-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="voice-modal voice-runtime-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
      >
        <header className="voice-modal-head">
          <h3 id={titleId} className="settings-heading">
            {t("voice.runtime.title")}
          </h3>
          {state.error ? (
            <button
              type="button"
              className="btn-mc dim btn-icon-sq voice-modal-close"
              title={t("voice.close")}
              aria-label={t("voice.close")}
              onClick={onClose}
            >
              <PixelCrossIcon />
            </button>
          ) : null}
        </header>

        <p className="friends-lead voice-runtime-copy">
          {t("voice.runtime.copy")}
        </p>

        {state.error ? (
          <div className="voice-runtime-error-block">
            <p className="friends-error" role="alert">
              {state.error.replace(/\s*Log:\s*\S+/gi, "").trim()}
            </p>
            {logPath ? (
              <p className="field-hint voice-runtime-logpath" title={logPath}>
                {t("voice.runtime.debugLog", { path: logPath })}
              </p>
            ) : null}
          </div>
        ) : (
          <PixelProgress
            value={state.percent}
            phase={state.phase || t("voice.runtime.phase")}
            label={state.message || t("voice.runtime.working")}
          />
        )}

        {state.error ? (
          <div className="voice-modal-actions btn-row">
            <button
              type="button"
              className="btn-mc dim"
              onClick={() => {
                void voiceRevealLog().catch(() => undefined);
              }}
            >
              {t("voice.runtime.openLog")}
            </button>
            <button type="button" className="btn-mc dim" onClick={onClose}>
              {t("voice.cancel")}
            </button>
            {onRetry ? (
              <button type="button" className="btn-mc ok" onClick={onRetry}>
                {t("voice.runtime.retry")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export const idleVoiceRuntimeModal = (): VoiceRuntimeModalState => ({
  open: false,
  phase: tr("voice.runtime.phase"),
  message: "",
  percent: 0,
  error: null,
});
