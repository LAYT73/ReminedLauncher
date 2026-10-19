import { useLauncherUpdate } from "@/features/launcher-update";
import { useProfileStore } from "@/entities/profile";

export function LauncherSection() {
  const appVersion = useProfileStore((s) => s.appVersion);
  const { busy: updateBusy, checkForUpdate } = useLauncherUpdate();

  return (
    <div className="settings-block">
      <h3 className="settings-heading">Launcher</h3>
      <div className="settings-row">
        <span>Version</span>
        <span className="settings-value">{appVersion}</span>
      </div>
      <div className="update-row">
        <button
          type="button"
          className="btn-mc ok"
          disabled={updateBusy}
          onClick={() => void checkForUpdate()}
        >
          {updateBusy ? "Checking…" : "Check for updates"}
        </button>
      </div>
    </div>
  );
}
