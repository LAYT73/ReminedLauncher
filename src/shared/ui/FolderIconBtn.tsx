import { PixelFolderIcon } from "./PixelIcons";

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
      <PixelFolderIcon />
    </button>
  );
}
