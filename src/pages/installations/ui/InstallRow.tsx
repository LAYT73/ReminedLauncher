import vanillaLogo from "@/shared/assets/vanilla.png";
import reminedVanillaLogo from "@/shared/assets/remined-vanilla-logo.png";
import { isReminedVanillaPackId, isVanillaPackId } from "@/shared/lib/packIds";
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
        {active ? <span className="install-badge">Selected</span> : null}
      </button>
      <div className="install-actions">
        <button
          type="button"
          className="btn-mc dim install-folder"
          title="Open folder"
          aria-label="Open folder"
          onClick={() => void revealPackFolder(pack.id)}
        >
          <svg viewBox="0 0 20 16" aria-hidden>
            <path d="M0 2h7l2 2h11v12H0V2z" />
          </svg>
        </button>
        <button
          type="button"
          className="btn-mc danger install-delete"
          onClick={() => void deleteInstalledPack(pack.id)}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
