import { useT } from "@/shared/i18n";
import { useState, type ReactNode } from "react";
import { dismissNote, isNoteDismissed } from "@/shared/lib/dismissedNotes";
import { PixelCrossIcon } from "./PixelIcons";

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
  const t = useT();
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
        title={t("shell.ui.dismiss")}
        aria-label={t("shell.ui.dismiss")}
        onClick={() => {
          dismissNote(id);
          setDismissed(true);
        }}
      >
        <PixelCrossIcon color="currentColor" className="info-note-close-icon" />
      </button>
    </div>
  );
}
