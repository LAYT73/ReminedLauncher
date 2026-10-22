import { useT } from "@/shared/i18n";
import { useId, useState, type ReactNode } from "react";

type Props = {
  title: ReactNode;
  /** Help copy shown when the "?" is open. */
  hint: ReactNode;
  /** Heading level for the title. */
  as?: "h2" | "h3";
  /** Right-side content in the title row (badges, actions). */
  end?: ReactNode;
  /** Title row class — default `page-title-row`. */
  className?: string;
};

/**
 * Page title with a "?" that reveals a short lead/hint on click.
 */
export function TitleHint({
  title,
  hint,
  as: Tag = "h2",
  end,
  className = "page-title-row",
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <>
      <div className={className}>
        <div className="page-title-hint-wrap">
          <Tag className="page-title">{title}</Tag>
          <button
            type="button"
            className={`title-hint-btn${open ? " is-open" : ""}`}
            aria-expanded={open}
            aria-controls={panelId}
            title={open ? t("shell.ui.hideHelp") : t("shell.ui.showHelp")}
            aria-label={open ? t("shell.ui.hideHelp") : t("shell.ui.showHelp")}
            onClick={() => setOpen((v) => !v)}
          >
            ?
          </button>
        </div>
        {end}
      </div>
      {open ? (
        <p id={panelId} className="friends-lead title-hint-panel" role="note">
          {hint}
        </p>
      ) : null}
    </>
  );
}
