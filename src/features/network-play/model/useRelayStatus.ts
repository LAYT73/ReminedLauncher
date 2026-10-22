import { t } from "@/shared/i18n";
import { useCallback, useEffect, useState } from "react";
import {
  ensureRelayCreds,
  openRelayDownload,
  relayCheck,
  relayGetPath,
  relaySetPath,
  relayStatus,
  type RelayCheckResult,
  type RelayStatus,
} from "@/shared/api/relay";
import { errorMessage } from "@/shared/lib/errors";

/** Remined Relay (frpc) status for Network settings. */
export function useRelayStatus(onToast: (message: string) => void) {
  const [status, setStatus] = useState<RelayStatus | null>(null);
  const [check, setCheck] = useState<RelayCheckResult | null>(null);
  const [pathDraft, setPathDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [st, custom] = await Promise.all([relayStatus(), relayGetPath()]);
      setStatus(st);
      // Only put a custom override in the input — auto path stays in the status line.
      setPathDraft(custom ?? "");
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runCheck() {
    if (busy || checking) return;
    setChecking(true);
    setError("");
    try {
      await ensureRelayCreds(true);
      const result = await relayCheck();
      setCheck(result);
      await refresh();
      onToast(result.ok ? t("network.toast.checkPassed") : t("network.toast.checkFailed"));
    } catch (err) {
      setCheck(null);
      setError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  }

  async function openDownload() {
    if (busy) return;
    setBusy(true);
    try {
      await openRelayDownload();
      onToast(t("network.toast.openingReleases"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function savePath(path: string | null) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await relaySetPath(path);
      setCheck(null);
      await refresh();
      onToast(path ? t("network.toast.pathSaved") : t("network.toast.autoDetect"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return {
    status,
    check,
    pathDraft,
    setPathDraft,
    busy,
    checking,
    error,
    refresh,
    runCheck,
    openDownload,
    savePath,
  };
}
