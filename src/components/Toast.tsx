import { useEffect } from "react";

type Props = {
  message: string | null;
  onDone: () => void;
};

export function Toast({ message, onDone }: Props) {
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onDone, 2200);
    return () => window.clearTimeout(t);
  }, [message, onDone]);

  if (!message) return null;

  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}
