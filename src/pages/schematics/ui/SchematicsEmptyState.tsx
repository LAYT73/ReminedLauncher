import { useT } from "@/shared/i18n";
import { PixelSchematicIcon } from "@/shared/ui/PixelIcons";
import { openImportDialog } from "../model/importFlow";
import { useSchematicsStore } from "../model/store";

const FORMATS = [
  { ext: ".litematic", key: "schematics.empty.litematic" },
  { ext: ".schem", key: "schematics.empty.schem" },
  { ext: ".nbt", key: "schematics.empty.nbt" },
] as const;

export function SchematicsEmptyState() {
  const t = useT();
  const importing = useSchematicsStore((s) => s.importing);
  const setSource = useSchematicsStore((s) => s.setSource);
  return (
    <div className="schem-empty">
      <div className="schem-empty-zone">
        <PixelSchematicIcon className="schem-empty-icon" />
        <h2 className="schem-empty-title">{t("schematics.empty.title")}</h2>
        <p className="schem-empty-body">{t("schematics.empty.body")}</p>
        <ul className="schem-empty-formats">
          {FORMATS.map((f) => (
            <li key={f.ext}>
              <strong>{f.ext}</strong>
              <span>{t(f.key)}</span>
            </li>
          ))}
        </ul>
        <div className="schem-empty-actions">
          <button
            type="button"
            className="btn-mc ok"
            disabled={importing}
            onClick={() => void openImportDialog()}
          >
            {t("schematics.library.import")}
          </button>
          <button type="button" className="btn-mc" onClick={() => setSource("catalog")}>
            {t("schematics.catalog.browse")}
          </button>
          <span className="schem-empty-hint">
            {t("schematics.empty.or")} {t("schematics.empty.drop").toLowerCase()}
          </span>
        </div>
      </div>
    </div>
  );
}
