import { useState } from "react";
import { revealDiagLogs } from "@/shared/api/diag";
import { netRevealLogDir } from "@/shared/api/netLog";
import { voiceRevealLog } from "@/features/voice/api/voiceNative";
import { FolderIconBtn } from "@/shared/ui/FolderIconBtn";
import { toast } from "@/shared/lib/toast";
import { useProfileStore } from "@/entities/profile";

/**
 * Safe diagnostics for anyone — only opens local log folders / copies version.
 * No secrets, tokens, or remote actions.
 */
export function DebugSection() {
  const appVersion = useProfileStore((s) => s.appVersion);
  const [busy, setBusy] = useState(false);

  async function openLogs() {
    if (busy) return;
    setBusy(true);
    try {
      await revealDiagLogs();
      toast("Opened launcher logs folder", "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "err");
    } finally {
      setBusy(false);
    }
  }

  async function openVoiceLog() {
    if (busy) return;
    setBusy(true);
    try {
      await voiceRevealLog();
      toast("Opened voice.log", "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "err");
    } finally {
      setBusy(false);
    }
  }

  async function openNetworkLogs() {
    if (busy) return;
    setBusy(true);
    try {
      await netRevealLogDir();
      toast("Opened network logs folder", "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "err");
    } finally {
      setBusy(false);
    }
  }

  async function copyVersion() {
    try {
      await navigator.clipboard.writeText(`Remined ${appVersion}`);
      toast("Copied version", "ok");
    } catch {
      toast("Could not copy", "err");
    }
  }

  return (
    <div className="settings-block" id="settings-debug">
      <h3 className="settings-heading">Debug</h3>
      <p className="field-hint">
        Local logs only — useful when reporting a bug. Nothing here leaves your
        PC.
      </p>

      <div className="settings-row">
        <span>Launcher logs</span>
        <div className="settings-row-actions">
          <FolderIconBtn
            title="Open logs folder"
            disabled={busy}
            onClick={() => void openLogs()}
          />
        </div>
      </div>

      <div className="settings-row">
        <span>Voice log</span>
        <div className="settings-row-actions">
          <FolderIconBtn
            title="Show voice.log"
            disabled={busy}
            onClick={() => void openVoiceLog()}
          />
        </div>
      </div>

      <div className="settings-row">
        <span>Network logs</span>
        <div className="settings-row-actions">
          <FolderIconBtn
            title="Open network logs"
            disabled={busy}
            onClick={() => void openNetworkLogs()}
          />
        </div>
      </div>

      <div className="settings-row">
        <span>Version</span>
        <div className="settings-row-actions">
          <span className="settings-value">{appVersion}</span>
          <button
            type="button"
            className="btn-mc dim"
            onClick={() => void copyVersion()}
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}
