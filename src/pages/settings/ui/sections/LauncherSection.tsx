import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useLauncherUpdate } from "@/features/launcher-update";
import { useT } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/errors";
import { toast } from "@/shared/lib/toast";
import { McToggle } from "@/shared/ui/McToggle";
import { useProfileStore } from "@/entities/profile";

const SPLIT = "\u0000";

export function LauncherSection() {
  const t = useT();
  const appVersion = useProfileStore((s) => s.appVersion);
  const { busy, pending, checkForUpdate, installPending, dismissPending } =
    useLauncherUpdate();
  const [autostart, setAutostart] = useState(false);

  useEffect(() => {
    let alive = true;
    void isEnabled()
      .then((on) => alive && setAutostart(on))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const toggleAutostart = (next: boolean) => {
    setAutostart(next);
    void (next ? enable() : disable()).catch((err) => {
      setAutostart(!next);
      toast(errorMessage(err), "err");
    });
  };

  const [readyPre = "", readyPost = ""] = t("settings.launcher.ready", {
    v: SPLIT,
  }).split(SPLIT);

  return (
    <div className="settings-block">
      <h3 className="settings-heading">{t("settings.launcher.title")}</h3>
      <div className="settings-row">
        <span>{t("settings.launcher.version")}</span>
        <span className="settings-value">{appVersion}</span>
      </div>
      <McToggle
        checked={autostart}
        onChange={toggleAutostart}
        label={t("settings.launcher.autostart")}
      />

      {pending ? (
        <div className="launcher-update-confirm">
          <p className="friends-lead">
            {readyPre}
            <strong>{pending.version}</strong>
            {readyPost}
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
              {busy
                ? t("settings.launcher.downloading")
                : t("settings.launcher.downloadInstall")}
            </button>
            <button
              type="button"
              className="btn-mc dim"
              disabled={busy}
              onClick={() => dismissPending()}
            >
              {t("settings.launcher.later")}
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
            {busy ? t("settings.launcher.checking") : t("settings.launcher.check")}
          </button>
        </div>
      )}
    </div>
  );
}
