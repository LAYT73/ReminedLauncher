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

const PHASE_LABEL: Record<string, string> = {
  java: "Java 25",
  pack: "Game pack",
  fabric: "Fabric runtime",
  assets: "Assets",
  runtime: "Runtime",
  done: "Done",
};

export function OnboardingScreen({ onDone }: Props) {
  const [phase, setPhase] = useState("java");
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState("Preparing…");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<ProgressEvent>("remined-progress", (ev) => {
      setPhase(ev.payload.phase);
      setPercent(ev.payload.percent);
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
    setMessage("Starting setup…");
    try {
      await invoke("run_onboarding");
      setPhase("done");
      setPercent(100);
      setMessage("Ready");
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
        <h1 className="gate-title">Installing Remined</h1>
        <p className="gate-sub">
          Java, default pack from catalog, and Fabric libraries — one pass with a progress bar.
        </p>

        <ul className="onboard-steps">
          {(["java", "pack", "fabric"] as const).map((id) => {
            const active = phase === id || (id === "fabric" && (phase === "assets" || phase === "runtime"));
            const done =
              phase === "done" ||
              (id === "java" && ["pack", "fabric", "assets", "runtime", "done"].includes(phase)) ||
              (id === "pack" && ["fabric", "assets", "runtime", "done"].includes(phase)) ||
              (id === "fabric" && phase === "done");
            return (
              <li key={id} className={`onboard-step ${done ? "is-done" : ""} ${active ? "is-active" : ""}`}>
                <span className="onboard-step-block" aria-hidden />
                <span>{PHASE_LABEL[id]}</span>
              </li>
            );
          })}
        </ul>

        <PixelProgress
          value={percent}
          phase={PHASE_LABEL[phase] ?? phase}
          label={message}
        />

        {error ? (
          <div className="onboard-error">
            <p className="gate-error">{error}</p>
            <button type="button" className="btn-mc" onClick={() => void start()} disabled={running}>
              Retry
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
