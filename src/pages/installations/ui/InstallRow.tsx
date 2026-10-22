import { useT } from "@/shared/i18n";
import vanillaLogo from "@/shared/assets/vanilla.png";
import reminedVanillaLogo from "@/shared/assets/remined-vanilla-logo.png";
import { isReminedVanillaPackId, isVanillaPackId } from "@/shared/lib/packIds";
import { PixelCheckIcon, PixelFolderIcon, PixelTrashIcon } from "@/shared/ui/PixelIcons";
import {
  deleteInstalledPack,
  revealPackFolder,
  selectInstalledPack,
} from "@/features/manage-installations";
import type { Pack } from "@/entities/pack";

type Props = {
  pack: Pack;
  /** Selected on its rail. */
  active: boolean;
  /** Catalog logo (Remined packs only). */
  logo: string | null | undefined;
};

export function InstallRow({ pack, active, logo }: Props) {
  const t = useT();
  const vanilla = isVanillaPackId(pack.id);
  const rv = isReminedVanillaPackId(pack.id);
  return (
    <li className="install-item">
      <button
        type="button"
        className={`install-row ${active ? "active" : ""}`}
        onClick={() => selectInstalledPack(pack)}
      >
        {vanilla ? (
          <img className="install-icon is-bare" src={vanillaLogo} alt="" />
        ) : rv ? (
          <img
            className="install-icon is-bare"
            src={reminedVanillaLogo}
            alt=""
          />
        ) : logo ? (
          <img className="install-icon is-bare" src={logo} alt="" />
        ) : (
          <span className="install-icon" aria-hidden />
        )}
        <span className="install-copy">
          <strong>{pack.name}</strong>
          <span>{pack.version}</span>
        </span>
        {active ? (
          <span
            className="install-badge"
            role="img"
            title={t("pack.installations.selected")}
            aria-label={t("pack.installations.selected")}
          >
            <PixelCheckIcon />
          </span>
        ) : null}
      </button>
      <div className="install-actions">
        <button
          type="button"
          className="btn-mc dim install-folder"
          title={t("pack.installations.openFolder")}
          aria-label={t("pack.installations.openFolder")}
          onClick={() => void revealPackFolder(pack.id)}
        >
          <PixelFolderIcon />
        </button>
        <button
          type="button"
          className="btn-mc danger install-delete"
          title={t("pack.installations.delete")}
          aria-label={t("pack.installations.delete")}
          onClick={() => void deleteInstalledPack(pack.id)}
        >
          <PixelTrashIcon />
        </button>
      </div>
    </li>
  );
}
