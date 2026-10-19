import { useState, type ReactNode } from "react";
import { dismissNote, isNoteDismissed } from "@/shared/lib/dismissedNotes";

type Props = {
  /** Stable id — used to remember dismissal across restarts. */
  id: string;
  children: ReactNode;
  /** Optional extra classes on the block. */
  className?: string;
  style?: React.CSSProperties;
};

/**
 * Info/note block with a dismiss (×) button. Dismissal is persisted to
 * localStorage, so a closed note stays hidden after restart.
 */
export function InfoNote({ id, children, className, style }: Props) {
  const [dismissed, setDismissed] = useState(() => isNoteDismissed(id));

  if (dismissed) return null;

  return (
    <div
      className={`friends-info-block info-note${
        className ? ` ${className}` : ""
      }`}
      role="note"
      style={style}
    >
      <div className="info-note-body">{children}</div>
      <button
        type="button"
        className="info-note-close"
        title="Dismiss"
        aria-label="Dismiss"
        onClick={() => {
          dismissNote(id);
          setDismissed(true);
        }}
      >
        <svg className="info-note-close-icon" viewBox="0 0 7 7" aria-hidden>
          <rect x="0" y="0" width="1" height="1" fill="currentColor" />
          <rect x="1" y="1" width="1" height="1" fill="currentColor" />
          <rect x="2" y="2" width="1" height="1" fill="currentColor" />
          <rect x="3" y="3" width="1" height="1" fill="currentColor" />
          <rect x="4" y="4" width="1" height="1" fill="currentColor" />
          <rect x="5" y="5" width="1" height="1" fill="currentColor" />
          <rect x="6" y="6" width="1" height="1" fill="currentColor" />
          <rect x="6" y="0" width="1" height="1" fill="currentColor" />
          <rect x="5" y="1" width="1" height="1" fill="currentColor" />
          <rect x="4" y="2" width="1" height="1" fill="currentColor" />
          <rect x="2" y="4" width="1" height="1" fill="currentColor" />
          <rect x="1" y="5" width="1" height="1" fill="currentColor" />
          <rect x="0" y="6" width="1" height="1" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
