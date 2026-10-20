import { open } from "@tauri-apps/plugin-dialog";
import { FolderIconBtn } from "@/shared/ui/FolderIconBtn";
import { usePortholeStatus } from "../model/usePortholeStatus";
import { useUnlimStatus } from "../model/useUnlimStatus";

type Props = {
  hostingSelf?: boolean;
  hostingPort?: number | null;
  /** You're in a voice room — remind that voice and LAN share nothing to configure. */
  voiceLive?: boolean;
  /** Nested under Settings — skip the page chrome title. */
  embedded?: boolean;
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
  embedded,
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
  } = usePortholeStatus(onToast);

  const unlim = useUnlimStatus(onToast);

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

  const unlimInstalled = Boolean(unlim.status?.installed);
  const unlimTone: "ok" | "warn" | "bad" | "idle" = !unlim.status
    ? "idle"
    : unlim.checking
      ? "idle"
      : unlim.check
        ? unlim.check.ok
          ? "ok"
          : unlimInstalled
            ? "warn"
            : "bad"
        : unlimInstalled
          ? "ok"
          : "bad";
  const unlimValue = !unlim.status
    ? "…"
    : unlim.checking
      ? "Checking"
      : unlim.check
        ? unlim.check.ok
          ? "Ready"
          : unlimInstalled
            ? "Issue"
            : "Missing"
        : unlimInstalled
          ? unlim.status.version
            ? `v${unlim.status.version}`
            : "Found"
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

  const unlimStatusClass = unlim.check
    ? unlim.check.ok
      ? "is-ready"
      : "is-missing"
    : unlimInstalled
      ? "is-ready"
      : "is-missing";
  const unlimTitle = unlim.check
    ? unlim.check.ok
      ? "Ready for voice"
      : "Needs attention"
    : unlimInstalled
      ? "Found"
      : "Not found";
  const unlimBody = unlim.checking
    ? "Checking Unlim…"
    : unlim.check
      ? unlim.check.message
      : unlimInstalled
        ? unlim.status?.path ?? "Binary found."
        : "Install Unlim for voice chat (separate from Network Play).";

  async function browseUnlim() {
    const selected = await open({ multiple: false, directory: false });
    if (!selected || Array.isArray(selected)) return;
    unlim.setPathDraft(selected);
    await unlim.savePath(selected);
  }

  const Root = embedded ? "div" : "section";
  return (
    <Root
      className={
        embedded ? "network-panel is-embedded" : "section network-panel"
      }
    >
      <div className={embedded ? "network-embedded-badges" : "page-title-row"}>
        {embedded ? null : <h2 className="page-title">Network Play</h2>}
        <div className="network-status-badges" aria-live="polite">
          <StatusBadge label="Steam" value={steamValue} tone={steamTone} />
          <StatusBadge
            label="Porthole"
            value={portholeValue}
            tone={portholeTone}
          />
          <StatusBadge label="Unlim" value={unlimValue} tone={unlimTone} />
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

      <div className="network-unlim">
        <h3 className="settings-heading">Unlim (voice)</h3>
        <p className="friends-lead">
          Voice chat uses <strong>Unlim</strong>, not Porthole. Free install from{" "}
          unlim.cc — both host and guests need it.
        </p>
        <div className={`network-status ${unlimStatusClass}`}>
          <div className="network-status-copy">
            <strong>{unlimTitle}</strong>
            <p>{unlimBody}</p>
          </div>
          <div className="network-status-actions">
            {!unlimInstalled ? (
              <button
                type="button"
                className="btn-mc ok"
                disabled={unlim.busy || unlim.checking}
                onClick={() => void unlim.openDownload()}
              >
                Get Unlim
              </button>
            ) : null}
            <button
              type="button"
              className="btn-mc ok"
              disabled={unlim.busy || unlim.checking}
              onClick={() => void unlim.runCheck()}
            >
              {unlim.checking ? "Checking…" : "Check"}
            </button>
            <button
              type="button"
              className="btn-mc dim"
              disabled={unlim.busy || unlim.checking}
              onClick={() => void unlim.refresh()}
            >
              Refresh
            </button>
            {unlimInstalled ? (
              <button
                type="button"
                className="btn-mc dim"
                disabled={unlim.busy || unlim.checking}
                onClick={() => void unlim.openDownload()}
              >
                unlim.cc
              </button>
            ) : null}
          </div>
        </div>
        {unlim.error ? <p className="friends-error">{unlim.error}</p> : null}
        {unlim.check && !unlim.check.ok && unlim.check.detail ? (
          <pre className="network-check-detail">{unlim.check.detail}</pre>
        ) : null}

        <div className="field">
          <label htmlFor="unlim-path">Unlim binary</label>
          <div className="field-row">
            <input
              id="unlim-path"
              type="text"
              spellCheck={false}
              placeholder="Auto-detect"
              value={unlim.pathDraft}
              onChange={(e) => unlim.setPathDraft(e.target.value)}
              onBlur={() => {
                const next = unlim.pathDraft.trim();
                void unlim.savePath(next || null);
              }}
            />
            <FolderIconBtn
              title="Browse for Unlim binary"
              disabled={unlim.busy}
              onClick={() => void browseUnlim()}
            />
            {unlim.status?.custom_path || unlim.pathDraft.trim() ? (
              <button
                type="button"
                className="btn-mc dim"
                disabled={unlim.busy}
                onClick={() => {
                  unlim.setPathDraft("");
                  void unlim.savePath(null);
                }}
              >
                Auto
              </button>
            ) : null}
          </div>
          <p className="field-hint">
            If auto-find misses it: Win → unlim.exe (often %APPDATA%\Unlim\bin\);
            Mac → Unlim/bin/unlim under Application Support.
          </p>
        </div>
      </div>
    </Root>
  );
}
