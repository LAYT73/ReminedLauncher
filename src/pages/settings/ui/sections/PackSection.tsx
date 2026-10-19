import { syncPack } from "@/features/play-game";
import { useInstallStore } from "@/entities/install";
import { useActiveReminePack } from "@/entities/pack";
import { useProfileStore } from "@/entities/profile";

export function PackSection() {
  const pack = useActiveReminePack();
  const selectedPack = useProfileStore((s) => s.profile.selected_pack);
  const packBusy = useInstallStore((s) => s.packSyncing);
  const packName = pack?.name ?? null;
  const packVersion = pack?.version ?? null;

  return (
    <div className="settings-block">
      <h3 className="settings-heading">Pack</h3>
      <div className="update-row">
        <button
          type="button"
          className="btn-mc ok"
          disabled={packBusy}
          onClick={() => void syncPack()}
        >
          {packBusy ? "Updating…" : "Update pack"}
        </button>
        <span className="settings-value">
          {packName ?? selectedPack ?? "—"}
          {packVersion ? ` · ${packVersion}` : ""}
        </span>
      </div>
    </div>
  );
}
