import { useEffect, useRef, useState } from "react";
import type { GameToastPayload } from "@/shared/lib/gameToast";

type Props = {
  payload: GameToastPayload | null;
  onDone: () => void;
};

const HOLD_MS = 3800;
const FADE_MS = 320;

/** Steam-like bottom-left join/play toast. */
export function GameToast({ payload, onDone }: Props) {
  const [active, setActive] = useState<GameToastPayload | null>(null);
  const [phase, setPhase] = useState<"in" | "out">("in");
  const onDoneRef = useRef(onDone);
  const seqRef = useRef(0);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!payload) return;
    const seq = ++seqRef.current;
    setActive(payload);
    setPhase("in");

    const hold = window.setTimeout(() => {
      if (seqRef.current !== seq) return;
      setPhase("out");
    }, HOLD_MS);

    const done = window.setTimeout(() => {
      if (seqRef.current !== seq) return;
      setActive(null);
      onDoneRef.current();
    }, HOLD_MS + FADE_MS);

    return () => {
      window.clearTimeout(hold);
      window.clearTimeout(done);
    };
  }, [payload]);

  if (!active) return null;

  return (
    <div
      className={`game-toast is-${phase}`}
      role="status"
      aria-live="polite"
    >
      <div className="game-toast-accent" aria-hidden />
      <div className="game-toast-copy">
        <strong className="game-toast-title">{active.title}</strong>
        {active.body ? (
          <span className="game-toast-body">{active.body}</span>
        ) : null}
      </div>
    </div>
  );
}
