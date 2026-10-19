import { useEffect, useRef, useState } from "react";
import type { ToastTone } from "@/shared/lib/toast";


type Props = {
  message: string | null;
  tone?: ToastTone;
  onDone: () => void;
};

const HOLD_MS = 2200;
const FADE_MS = 260;

export function Toast({ message, tone = "default", onDone }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [activeTone, setActiveTone] = useState<ToastTone>("default");
  const [phase, setPhase] = useState<"in" | "out">("in");
  const onDoneRef = useRef(onDone);
  const seqRef = useRef(0);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!message) return;
    const seq = ++seqRef.current;
    setText(message);
    setActiveTone(tone);
    setPhase("in");

    const hold = window.setTimeout(() => {
      if (seqRef.current !== seq) return;
      setPhase("out");
    }, HOLD_MS);

    const done = window.setTimeout(() => {
      if (seqRef.current !== seq) return;
      setText(null);
      onDoneRef.current();
    }, HOLD_MS + FADE_MS);

    return () => {
      window.clearTimeout(hold);
      window.clearTimeout(done);
    };
  }, [message, tone]);

  if (!text) return null;

  const toneClass =
    activeTone === "ok" ? " is-ok" : activeTone === "err" ? " is-err" : "";

  return (
    <div
      className={`toast is-${phase}${toneClass}`}
      role="status"
      aria-live="polite"
    >
      {text}
    </div>
  );
}
