import { useCallback, useEffect, useState } from "react";
import {
  openPortholeOnSteam,
  openPortholeStore,
  openSteamClient,
  portholeSelftest,
  portholeStatus,
  type PortholeCheckResult,
  type PortholeStatus,
} from "@/shared/api/porthole";
import { TIMING } from "@/shared/config/timings";

/** Porthole / Steam status, polling and the Steam-related actions of Network Play. */
export function usePortholeStatus(onToast: (message: string) => void) {
  const [status, setStatus] = useState<PortholeStatus | null>(null);
  const [check, setCheck] = useState<PortholeCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      setStatus(await portholeStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), TIMING.portholePoll);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function openSteam(install: boolean) {
    if (busy || checking) return;
    setBusy(true);
    try {
      if (install) {
        await openPortholeOnSteam(status);
        onToast("Opening Steam — install Porthole, then come back");
      } else {
        await openPortholeStore(status);
        onToast("Opening Porthole on Steam");
      }
      window.setTimeout(() => void refresh(), TIMING.portholeRecheckAfterStore);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function launchSteamApp() {
    if (busy || checking) return;
    setBusy(true);
    setError("");
    try {
      const msg = await openSteamClient();
      onToast(msg || "Opening Steam…");
      window.setTimeout(() => void refresh(), TIMING.portholeRecheckAfterSteam);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runCheck() {
    if (busy || checking) return;
    setChecking(true);
    setError("");
    try {
      const result = await portholeSelftest();
      setCheck(result);
      await refresh();
      if (result.ok) {
        onToast("Porthole check passed");
      } else if (!result.steam_ok) {
        onToast("Steam closed — opening Steam…");
        try {
          await openSteamClient();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } else {
        onToast("Porthole check failed");
      }
    } catch (err) {
      setCheck(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  return {
    status,
    check,
    busy,
    checking,
    error,
    refresh,
    openSteam,
    launchSteamApp,
    runCheck,
  };
}
