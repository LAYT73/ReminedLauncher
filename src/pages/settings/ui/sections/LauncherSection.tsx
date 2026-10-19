import { useLauncherUpdate } from "@/features/launcher-update";
import { useProfileStore } from "@/entities/profile";

export function LauncherSection() {
  const appVersion = useProfileStore((s) => s.appVersion);
  const { busy, pending, checkForUpdate, installPending, dismissPending } =
    useLauncherUpdate();

  return (
    <div className="settings-block">
      <h3 className="settings-heading">Launcher</h3>
      <div className="settings-row">
        <span>Version</span>
        <span className="settings-value">{appVersion}</span>
      </div>

      {pending ? (
        <div className="launcher-update-confirm">
          <p className="friends-lead">
            Version <strong>{pending.version}</strong> is ready to install.
            Remined will download it and restart.
          </p>
          {pending.notes ? (
            <pre className="launcher-update-notes">{pending.notes}</pre>
          ) : null}
          <div className="update-row">
            <button
              type="button"
              className="btn-mc ok"
              disabled={busy}
              onClick={() => void installPending()}
            >
              {busy ? "Downloading…" : "Download & install"}
            </button>
            <button
              type="button"
              className="btn-mc dim"
              disabled={busy}
              onClick={() => dismissPending()}
            >
              Later
            </button>
          </div>
        </div>
      ) : (
        <div className="update-row">
          <button
            type="button"
            className="btn-mc ok"
            disabled={busy}
            onClick={() => void checkForUpdate()}
          >
            {busy ? "Checking…" : "Check for updates"}
          </button>
        </div>
      )}
    </div>
  );
}
