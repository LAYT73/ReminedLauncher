import { useState } from "react";
import { revealDiagLogs } from "@/shared/api/diag";
import { netRevealLogDir } from "@/shared/api/netLog";
import { voiceRevealLog } from "@/features/voice";
import { FolderIconBtn } from "@/shared/ui/FolderIconBtn";
import { toast } from "@/shared/lib/toast";
import { errorMessage } from "@/shared/lib/errors";
import { useProfileStore } from "@/entities/profile";
import { useT } from "@/shared/i18n";

/**
 * Safe diagnostics for anyone — only opens local log folders / copies version.
 * No secrets, tokens, or remote actions.
 */
export function DebugSection() {
  const t = useT();
  const appVersion = useProfileStore((s) => s.appVersion);
  const [busy, setBusy] = useState(false);

  async function openLogs() {
    if (busy) return;
    setBusy(true);
    try {
      await revealDiagLogs();
      toast(t("settings.debug.openedLogs"), "ok");
    } catch (err) {
      toast(errorMessage(err), "err");
    } finally {
      setBusy(false);
    }
  }

  async function openVoiceLog() {
    if (busy) return;
    setBusy(true);
    try {
      await voiceRevealLog();
      toast(t("settings.debug.openedVoiceLog"), "ok");
    } catch (err) {
      toast(errorMessage(err), "err");
    } finally {
      setBusy(false);
    }
  }

  async function openNetworkLogs() {
    if (busy) return;
    setBusy(true);
    try {
      await netRevealLogDir();
      toast(t("settings.debug.openedNetworkLogs"), "ok");
    } catch (err) {
      toast(errorMessage(err), "err");
    } finally {
      setBusy(false);
    }
  }

  async function copyVersion() {
    try {
      await navigator.clipboard.writeText(`Remined ${appVersion}`);
      toast(t("settings.debug.copiedVersion"), "ok");
    } catch {
      toast(t("settings.debug.couldNotCopy"), "err");
    }
  }

  return (
    <div className="settings-block" id="settings-debug">
      <h3 className="settings-heading">{t("settings.debug.title")}</h3>

      <div className="settings-row">
        <span>{t("settings.debug.launcherLogs")}</span>
        <div className="settings-row-actions">
          <FolderIconBtn
            title={t("settings.debug.openLogs")}
            disabled={busy}
            onClick={() => void openLogs()}
          />
        </div>
      </div>

      <div className="settings-row">
        <span>{t("settings.debug.voiceLog")}</span>
        <div className="settings-row-actions">
          <FolderIconBtn
            title={t("settings.debug.showVoiceLog")}
            disabled={busy}
            onClick={() => void openVoiceLog()}
          />
        </div>
      </div>

      <div className="settings-row">
        <span>{t("settings.debug.networkLogs")}</span>
        <div className="settings-row-actions">
          <FolderIconBtn
            title={t("settings.debug.openNetworkLogs")}
            disabled={busy}
            onClick={() => void openNetworkLogs()}
          />
        </div>
      </div>

      <div className="settings-row">
        <span>{t("settings.debug.version")}</span>
        <div className="settings-row-actions">
          <span className="settings-value">{appVersion}</span>
          <button
            type="button"
            className="btn-mc dim"
            onClick={() => void copyVersion()}
          >
            {t("settings.debug.copyVersion")}
          </button>
        </div>
      </div>
    </div>
  );
}
