import { syncPack } from "@/features/play-game";
import { useT } from "@/shared/i18n";
import { useInstallStore } from "@/entities/install";
import { useActiveReminePack } from "@/entities/pack";
import { useProfileStore } from "@/entities/profile";

export function PackSection() {
  const t = useT();
  const pack = useActiveReminePack();
  const selectedPack = useProfileStore((s) => s.profile.selected_pack);
  const packBusy = useInstallStore((s) => s.packSyncing);
  const packName = pack?.name ?? null;
  const packVersion = pack?.version ?? null;

  return (
    <div className="settings-block">
      <h3 className="settings-heading">{t("settings.pack.title")}</h3>
      <div className="update-row">
        <button
          type="button"
          className="btn-mc ok"
          disabled={packBusy}
          onClick={() => void syncPack()}
        >
          {packBusy ? t("settings.pack.updating") : t("settings.pack.update")}
        </button>
        <span className="settings-value">
          {packName ?? selectedPack ?? "—"}
          {packVersion ? ` · ${packVersion}` : ""}
        </span>
      </div>
    </div>
  );
}
