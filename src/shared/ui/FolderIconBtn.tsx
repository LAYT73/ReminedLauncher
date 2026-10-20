type Props = {
  title: string;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
};

/** Square Browse / Show-folder control with a folder glyph. */
export function FolderIconBtn({ title, disabled, className, onClick }: Props) {
  return (
    <button
      type="button"
      className={["btn-mc dim btn-icon-sq", className].filter(Boolean).join(" ")}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      <svg viewBox="0 0 20 16" width="16" height="13" aria-hidden>
        <path fill="currentColor" d="M0 2h7l2 2h11v12H0V2z" />
      </svg>
    </button>
  );
}
