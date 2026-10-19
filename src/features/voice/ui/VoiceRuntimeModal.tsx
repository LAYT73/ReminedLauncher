import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { voiceLogPath, voiceRevealLog } from "../api/voiceNative";
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
            Setting up voice
          </h3>
          {state.error ? (
            <button type="button" className="btn-mc dim" onClick={onClose}>
              Close
            </button>
          ) : null}
        </header>

        <p className="friends-lead voice-runtime-copy">
          Remined downloads a small local voice server once, then hosts rooms on
          your PC. No Terminal or Homebrew needed.
        </p>

        {state.error ? (
          <div className="voice-runtime-error-block">
            <p className="friends-error" role="alert">
              {state.error.replace(/\s*Log:\s*\S+/gi, "").trim()}
            </p>
            {logPath ? (
              <p className="field-hint voice-runtime-logpath" title={logPath}>
                Debug log: {logPath}
              </p>
            ) : null}
          </div>
        ) : (
          <PixelProgress
            value={state.percent}
            phase={state.phase || "Voice"}
            label={state.message || "Working…"}
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
              Open log
            </button>
            <button type="button" className="btn-mc dim" onClick={onClose}>
              Cancel
            </button>
            {onRetry ? (
              <button type="button" className="btn-mc ok" onClick={onRetry}>
                Retry
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
  phase: "Voice",
  message: "",
  percent: 0,
  error: null,
});
