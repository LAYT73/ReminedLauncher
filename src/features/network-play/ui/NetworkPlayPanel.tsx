import { usePortholeStatus } from "../model/usePortholeStatus";

type Props = {
  hostingSelf?: boolean;
  hostingPort?: number | null;
  /** You're in a voice room — remind that voice and LAN share nothing to configure. */
  voiceLive?: boolean;
  onToast: (msg: string) => void;
};

function StatusBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad" | "idle";
}) {
  return (
    <span className={`network-pill is-${tone}`} title={`${label}: ${value}`}>
      <span className="network-pill-dot" aria-hidden />
      <span className="network-pill-label">{label}</span>
      <span className="network-pill-value">{value}</span>
    </span>
  );
}

export function NetworkPlayPanel({
  hostingSelf,
  hostingPort,
  voiceLive,
  onToast,
}: Props) {
  const {
    status,
    check,
    busy,
    checking,
    error,
    refresh,
    openSteam,
    launchSteamApp,
    runCheck,
  } =
    usePortholeStatus(onToast);

  const installed = Boolean(status?.installed);
  const steamOk =
    check != null ? check.steam_ok : status?.steam_ok === true;
  const steamKnown =
    check != null || status?.steam_ok === true || status?.steam_ok === false;

  const steamTone: "ok" | "warn" | "bad" | "idle" = !status
    ? "idle"
    : checking
      ? "idle"
      : steamOk
        ? "ok"
        : steamKnown
          ? "bad"
          : "warn";
  const steamValue = !status
    ? "…"
    : checking
      ? "Checking"
      : steamOk
        ? "Running"
        : steamKnown
          ? "Closed"
          : "Unknown";

  const portholeTone: "ok" | "warn" | "bad" | "idle" = !status
    ? "idle"
    : checking
      ? "idle"
      : check
        ? check.ok
          ? "ok"
          : installed
            ? "warn"
            : "bad"
        : installed
          ? "ok"
          : "bad";
  const portholeValue = !status
    ? "…"
    : checking
      ? "Checking"
      : check
        ? check.ok
          ? "Ready"
          : installed
            ? "Issue"
            : "Missing"
        : installed
          ? "Installed"
          : "Missing";

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
      <div className="page-title-row">
        <h2 className="page-title">Network Play</h2>
        <div className="network-status-badges" aria-live="polite">
          <StatusBadge label="Steam" value={steamValue} tone={steamTone} />
          <StatusBadge
            label="Porthole"
            value={portholeValue}
            tone={portholeTone}
          />
        </div>
      </div>
      {voiceLive ? (
        <p className="friends-lead">
          Voice room is live — friends hear you while you play; nothing extra to
          set up.
        </p>
      ) : null}
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
              className="btn-mc ok"
              disabled={busy || checking}
              onClick={() => void openSteam(true)}
            >
              Install on Steam
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn-mc ok"
                disabled={busy || checking}
                onClick={() => void runCheck()}
              >
                {checking ? "Checking…" : "Check"}
              </button>
              {check && !check.ok && !check.steam_ok ? (
                <button
                  type="button"
                  className="btn-mc ok"
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
