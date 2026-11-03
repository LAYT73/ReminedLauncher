import { useT } from "@/shared/i18n";
import { PixelUploadIcon } from "@/shared/ui/PixelIcons";

export function DropOverlay() {
  const t = useT();
  return (
    <div className="schem-drop-overlay" role="presentation">
      <div className="schem-drop-card">
        <PixelUploadIcon className="schem-drop-icon" />
        <span>{t("schematics.drop.overlay")}</span>
      </div>
    </div>
  );
}
