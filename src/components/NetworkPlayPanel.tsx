import { useCallback, useEffect, useState } from "react";
import {
  openPortholeOnSteam,
  openPortholeStore,
  openSteamClient,
  portholeSelftest,
  portholeStatus,
  type PortholeCheckResult,
  type PortholeStatus,
} from "../lib/porthole";

type Props = {
  hostingSelf?: boolean;
  hostingPort?: number | null;
  onToast: (msg: string) => void;
};

export function NetworkPlayPanel({
  hostingSelf,
  hostingPort,
  onToast,
}: Props) {
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
    const id = window.setInterval(() => void refresh(), 15_000);
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
      window.setTimeout(() => void refresh(), 2500);
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
      window.setTimeout(() => void refresh(), 4000);
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

  const installed = Boolean(status?.installed);
  const statusClass = check
    ? check.ok
      ? "is-ready"
      : "is-missing"
    : installed
      ? "is-ready"
      : "is-missing";
  const title = check
    ? check.ok
      ? "All set"
      : "Needs attention"
    : installed
      ? "Ready"
      : "Not installed";
  const body = checking
    ? "Checking Steam connection…"
    : check
      ? check.ok
        ? "Steam and the tunnel look good."
        : check.message
      : installed
        ? "Leave Steam open and logged in to host or join."
        : "Install free Porthole on Steam to play with friends online.";

  return (
    <section className="section network-panel">
      <h2 className="page-title">Network Play</h2>
      <p className="friends-lead">
        Play Open-to-LAN worlds with friends over the internet. Remined uses{" "}
        <strong>Porthole</strong> — a free Steam app that tunnels your LAN port
        securely. Steam must be installed and logged in on every PC.
      </p>

      <div className={`network-status ${statusClass}`}>
        <div className="network-status-copy">
          <strong>{title}</strong>
          <p>{body}</p>
        </div>
        <div className="network-status-actions">
          {!installed ? (
            <button
              type="button"
              className="btn-mc"
              disabled={busy || checking}
              onClick={() => void openSteam(true)}
            >
              Install on Steam
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn-mc"
                disabled={busy || checking}
                onClick={() => void runCheck()}
              >
                {checking ? "Checking…" : "Check"}
              </button>
              {check && !check.ok && !check.steam_ok ? (
                <button
                  type="button"
                  className="btn-mc"
                  disabled={busy || checking}
                  onClick={() => void launchSteamApp()}
                >
                  Open Steam
                </button>
              ) : null}
              <button
                type="button"
                className="btn-mc dim"
                disabled={busy || checking}
                onClick={() => void openSteam(false)}
              >
                Open Steam page
              </button>
            </>
          )}
          <button
            type="button"
            className="btn-mc dim"
            disabled={busy || checking}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? <p className="friends-error">{error}</p> : null}
      {check && !check.ok && check.detail ? (
        <pre className="network-check-detail">{check.detail}</pre>
      ) : null}

      {hostingSelf ? (
        <p className="friends-hosting-banner" role="status">
          You are hosting
          {hostingPort ? ` on port ${hostingPort}` : ""} — friends can Join from
          the Friends tab.
        </p>
      ) : null}

      <div className="network-steps">
        <div className="network-step">
          <h3 className="settings-heading">Host</h3>
          <ol>
            <li>Install Porthole from Steam (button above) and leave Steam running.</li>
            <li>Play → open a world → pause → <strong>Open to LAN</strong>.</li>
            <li>
              Remined detects the port, starts Porthole, and marks you as{" "}
              <strong>Hosting</strong> for friends.
            </li>
          </ol>
        </div>
        <div className="network-step">
          <h3 className="settings-heading">Join a friend</h3>
          <ol>
            <li>Same setup: Steam + Porthole installed and logged in.</li>
            <li>
              Friends tab → when they show <strong>Hosting</strong>, hit{" "}
              <strong>Join</strong>.
            </li>
            <li>
              Remined connects the tunnel and launches their pack straight into
              the world.
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}
