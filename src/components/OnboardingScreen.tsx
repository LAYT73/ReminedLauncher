import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { PixelProgress } from "./PixelProgress";

type ProgressEvent = {
  phase: string;
  percent: number;
  message: string;
};

type Props = {
  onDone: () => void;
};

export function OnboardingScreen({ onDone }: Props) {
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState("Checking Java…");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<ProgressEvent>("remined-progress", (ev) => {
      setPercent((prev) => Math.max(prev, ev.payload.percent));
      setMessage(ev.payload.message);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  async function start() {
    setRunning(true);
    setError("");
    setPercent(0);
    setMessage("Checking Java…");
    try {
      await invoke("run_onboarding");
      setPercent(100);
      setMessage("Java ready");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
        <p className="gate-kicker">First-time setup</p>
        <h1 className="gate-title">Java setup</h1>
        <p className="gate-sub">
          Remined needs Java 25. Packs download later from the Play screen.
        </p>

        <PixelProgress value={percent} phase="Java 25" label={message} />

        {error ? (
          <div className="onboard-error">
            <p className="gate-error">{error}</p>
            <button
              type="button"
              className="btn-mc"
              onClick={() => void start()}
              disabled={running}
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
