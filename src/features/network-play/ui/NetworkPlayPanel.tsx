import { open } from "@tauri-apps/plugin-dialog";
import { FolderIconBtn } from "@/shared/ui/FolderIconBtn";
import { useRelayStatus } from "../model/useRelayStatus";

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
  const relay = useRelayStatus(onToast);

  const relayInstalled = Boolean(relay.status?.installed);
  const relayTone: "ok" | "warn" | "bad" | "idle" = !relay.status
    ? "idle"
    : relay.checking
      ? "idle"
      : relay.check
        ? relay.check.ok
          ? "ok"
          : relayInstalled
            ? "warn"
            : "bad"
        : relayInstalled
          ? "ok"
          : "bad";
  const relayValue = !relay.status
    ? "…"
    : relay.checking
      ? "Checking"
      : relay.check
        ? relay.check.ok
          ? "Ready"
          : relayInstalled
            ? "Issue"
            : "Missing"
        : relayInstalled
          ? relay.status.version
            ? `v${relay.status.version}`
            : "Found"
          : "Missing";

  const relayStatusClass = relay.check
    ? relay.check.ok
      ? "is-ready"
      : "is-missing"
    : relayInstalled
      ? "is-ready"
      : "is-missing";
  const relayTitle = relay.check
    ? relay.check.ok
      ? "Ready for voice + LAN"
      : "Needs attention"
    : relayInstalled
      ? "Found"
      : "Not found";
  const relayBody = relay.checking
    ? "Checking Relay…"
    : relay.check
      ? relay.check.message
      : relayInstalled
        ? relay.status?.path ?? "Binary found."
        : "Tap Check to download frpc for voice and Open-to-LAN.";

  async function browseRelay() {
    const selected = await open({ multiple: false, directory: false });
    if (!selected || Array.isArray(selected)) return;
    relay.setPathDraft(selected);
    await relay.savePath(selected);
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
          <StatusBadge label="Relay" value={relayValue} tone={relayTone} />
        </div>
      </div>

      {voiceLive ? (
        <p className="friends-lead">
          Voice room is live — friends hear you while you play; nothing extra to
          set up.
        </p>
      ) : null}

      <div className="network-relay">
        <h3 className="settings-heading">Remined Relay</h3>
        <p className="friends-lead">
          Voice and Open-to-LAN go through <strong>Remined Relay</strong> on your
          server. Friends only need Remined.
        </p>
        <div className={`network-status ${relayStatusClass}`}>
          <div className="network-status-copy">
            <strong>{relayTitle}</strong>
            <p>{relayBody}</p>
          </div>
          <div className="network-status-actions">
            {!relayInstalled ? (
              <button
                type="button"
                className="btn-mc ok"
                disabled={relay.busy || relay.checking}
                onClick={() => void relay.openDownload()}
              >
                Get frpc
              </button>
            ) : null}
            <button
              type="button"
              className="btn-mc ok"
              disabled={relay.busy || relay.checking}
              onClick={() => void relay.runCheck()}
            >
              {relay.checking ? "Checking…" : "Check"}
            </button>
            <button
              type="button"
              className="btn-mc dim"
              disabled={relay.busy || relay.checking}
              onClick={() => void relay.refresh()}
            >
              Refresh
            </button>
            {relayInstalled ? (
              <button
                type="button"
                className="btn-mc dim"
                disabled={relay.busy || relay.checking}
                onClick={() => void relay.openDownload()}
              >
                frp releases
              </button>
            ) : null}
          </div>
        </div>
        {relay.error ? <p className="friends-error">{relay.error}</p> : null}
        {relay.check && !relay.check.ok && relay.check.detail ? (
          <pre className="network-check-detail">{relay.check.detail}</pre>
        ) : null}

        <div className="field">
          <label htmlFor="relay-path">frpc binary</label>
          <div className="field-row">
            <input
              id="relay-path"
              type="text"
              spellCheck={false}
              placeholder="Auto-detect"
              value={relay.pathDraft}
              onChange={(e) => relay.setPathDraft(e.target.value)}
              onBlur={() => {
                const next = relay.pathDraft.trim();
                void relay.savePath(next || null);
              }}
            />
            <FolderIconBtn
              title="Browse for frpc binary"
              disabled={relay.busy}
              onClick={() => void browseRelay()}
            />
            {relay.status?.custom_path || relay.pathDraft.trim() ? (
              <button
                type="button"
                className="btn-mc dim"
                disabled={relay.busy}
                onClick={() => {
                  relay.setPathDraft("");
                  void relay.savePath(null);
                }}
              >
                Auto
              </button>
            ) : null}
          </div>
          <p className="field-hint">
            If auto-find misses it: point at frpc (downloaded under .remined/frp/).
          </p>
        </div>
      </div>

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
            <li>Tap Check to install frpc (once per PC).</li>
            <li>
              Play → open a world → pause → <strong>Open to LAN</strong>.
            </li>
            <li>
              Remined picks up the port automatically and marks you as{" "}
              <strong>Hosting</strong>.
            </li>
          </ol>
        </div>
        <div className="network-step">
          <h3 className="settings-heading">Join a friend</h3>
          <ol>
            <li>
              Friends tab → when they show <strong>Hosting</strong>, hit{" "}
              <strong>Join</strong>.
            </li>
            <li>
              Remined connects the relay and launches their pack into the world.
            </li>
          </ol>
        </div>
      </div>
    </Root>
  );
}
