import { listen } from "@tauri-apps/api/event";
import { call } from "@/shared/api/invoke";
import { useEffect, useState } from "react";
import { PixelProgress } from "@/shared/ui/PixelProgress";
import { CMD } from "@/shared/config/commands";
import { EVENT } from "@/shared/config/events";
import { errorMessage } from "@/shared/lib/errors";
import { useT } from "@/shared/i18n";
import type { ProgressEvent } from "@/entities/install";
import { finishOnboarding } from "../model/finish-onboarding";

export function OnboardingScreen() {
  const t = useT();
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState(() => t("auth.onboarding.checkingJava"));
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<ProgressEvent>(EVENT.progress, (ev) => {
      setPercent((prev) => Math.max(prev, ev.payload.percent));
      setMessage(ev.payload.message);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  async function start() {
    setRunning(true);
    setError("");
    setPercent(0);
    setMessage(t("auth.onboarding.checkingJava"));
    try {
      await call(CMD.runOnboarding);
      setPercent(100);
      setMessage(t("auth.onboarding.javaReady"));
      await finishOnboarding();
    } catch (err) {
      setError(errorMessage(err));
      setRunning(false);
    }
  }

  useEffect(() => {
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="gate-screen onboard-screen">
      <div className="gate-panel onboard-panel">
        <p className="gate-kicker">{t("auth.onboarding.kicker")}</p>
        <h1 className="gate-title">{t("auth.onboarding.title")}</h1>
        <p className="gate-sub">
          {t("auth.onboarding.sub")}
        </p>

        <PixelProgress value={percent} phase="Java 25" label={message} />

        {error ? (
          <div className="onboard-error">
            <p className="gate-error">{error}</p>
            <button
              type="button"
              className="btn-mc ok"
              onClick={() => void start()}
              disabled={running}
            >
              {t("common.retry")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
