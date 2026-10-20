import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { NetworkMode } from "@/entities/profile";
import {
  DEFAULT_LAN_PORT,
  normalizeLanPort,
  useProfileStore,
} from "@/entities/profile";
import { useCurrentPackId } from "@/entities/pack";
import { unlimApplyLanPort } from "@/shared/api/unlim";
import { FolderIconBtn } from "@/shared/ui/FolderIconBtn";
import { McSelect } from "@/shared/ui/McSelect";
import { useRail } from "@/shared/lib/useRoute";
import { usePortholeStatus } from "../model/usePortholeStatus";
import { useUnlimStatus } from "../model/useUnlimStatus";

const NETWORK_MODE_OPTIONS = [
  {
    id: "unlim",
    label: "Unlim only",
    hint: "Default — voice + LAN, no Porthole",
  },
  {
    id: "hybrid",
    label: "Hybrid",
    hint: "Porthole for LAN + Unlim for voice",
  },
] as const;

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
  const networkMode = useProfileStore((s) => s.profile.network_mode);
  const lanPort = useProfileStore((s) => s.profile.lan_port);
  const persist = useProfileStore((s) => s.persist);
  const profile = useProfileStore((s) => s.profile);
  const packId = useCurrentPackId(useRail());
  const [portDraft, setPortDraft] = useState(String(lanPort || DEFAULT_LAN_PORT));

  useEffect(() => {
    setPortDraft(String(lanPort || DEFAULT_LAN_PORT));
  }, [lanPort]);

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
  const hybrid = networkMode === "hybrid";

  async function setMode(next: NetworkMode) {
    if (next === networkMode) return;
    await persist({ ...profile, network_mode: next });
    onToast(
      next === "unlim"
        ? "Network mode: Unlim only (no Porthole)"
        : "Network mode: Hybrid (Porthole + Unlim)",
    );
  }

  async function commitLanPort() {
    const next = normalizeLanPort(portDraft.trim() || DEFAULT_LAN_PORT);
    setPortDraft(String(next));
    if (next === lanPort) return;
    await persist({ ...profile, lan_port: next });
    if (packId) {
      await unlimApplyLanPort(packId, next).catch(() => undefined);
    }
    onToast(`LAN port set to ${next}`);
  }

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
      ? hybrid
        ? "Ready for voice"
        : "Ready for voice + LAN"
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
        : hybrid
          ? "Install Unlim for voice chat (LAN stays on Porthole)."
          : "Install Unlim for voice and Open-to-LAN (no Steam/Porthole).";

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
          <StatusBadge label="Unlim" value={unlimValue} tone={unlimTone} />
          {hybrid ? (
            <>
              <StatusBadge label="Steam" value={steamValue} tone={steamTone} />
              <StatusBadge
                label="Porthole"
                value={portholeValue}
                tone={portholeTone}
              />
            </>
          ) : null}
        </div>
      </div>

      <div className="field network-mode-field">
        <McSelect
          label="Tunnel mode"
          value={networkMode}
          options={[...NETWORK_MODE_OPTIONS]}
          menuPlacement="down"
          onChange={(id) => void setMode(id as NetworkMode)}
        />
      </div>

      <div className="field">
        <label htmlFor="lan-port">Open-to-LAN port</label>
        <div className="field-row">
          <input
            id="lan-port"
            type="number"
            min={1024}
            max={65535}
            inputMode="numeric"
            spellCheck={false}
            value={portDraft}
            onChange={(e) => setPortDraft(e.target.value)}
            onBlur={() => void commitLanPort()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
          />
          <button
            type="button"
            className="btn-mc dim"
            onClick={() => {
              setPortDraft(String(DEFAULT_LAN_PORT));
              void (async () => {
                await persist({ ...profile, lan_port: DEFAULT_LAN_PORT });
                if (packId) {
                  await unlimApplyLanPort(packId, DEFAULT_LAN_PORT).catch(
                    () => undefined,
                  );
                }
                onToast(`LAN port reset to ${DEFAULT_LAN_PORT}`);
              })();
            }}
          >
            Default
          </button>
        </div>
      </div>

      {voiceLive ? (
        <p className="friends-lead">
          Voice room is live — friends hear you while you play; nothing extra to
          set up.
        </p>
      ) : null}

      <div className="network-unlim">
        <h3 className="settings-heading">
          {hybrid ? "Unlim (voice)" : "Unlim (voice + LAN)"}
        </h3>
        <p className="friends-lead">
          {hybrid ? (
            <>
              Voice chat uses <strong>Unlim</strong>, not Porthole. Free from{" "}
              unlim.cc — both host and guests need it.
            </>
          ) : (
            <>
              Remined tunnels voice and Open-to-LAN through{" "}
              <strong>Unlim</strong> (unlim.cc). Friends only need Unlim — no
              Steam or Porthole.
            </>
          )}
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

      {hybrid ? (
        <>
          <p className="friends-lead">
            Open-to-LAN uses <strong>Porthole</strong> — a free Steam app.
            Steam must be installed and logged in on every PC for Network Play.
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
        </>
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
            {hybrid ? (
              <>
                <li>
                  Install Porthole from Steam (button above) and leave Steam
                  running. Install Unlim for voice.
                </li>
                <li>
                  Play → open a world → pause → <strong>Open to LAN</strong>{" "}
                  (use the LAN port above in Open to LAN / mcwifipnp).
                </li>
                <li>
                  Remined starts Porthole and marks you as{" "}
                  <strong>Hosting</strong> for friends.
                </li>
              </>
            ) : (
              <>
                <li>Install Unlim (button above) on every PC.</li>
                <li>
                  Play → open a world → pause → <strong>Open to LAN</strong>{" "}
                  (port from the field above).
                </li>
                <li>
                  Remined opens one Unlim lobby (voice-ready) and marks you as{" "}
                  <strong>Hosting</strong>.
                </li>
              </>
            )}
          </ol>
        </div>
        <div className="network-step">
          <h3 className="settings-heading">Join a friend</h3>
          <ol>
            {hybrid ? (
              <>
                <li>Same setup: Steam + Porthole (and Unlim for voice).</li>
                <li>
                  Friends tab → when they show <strong>Hosting</strong>, hit{" "}
                  <strong>Join</strong>.
                </li>
                <li>
                  Remined connects the tunnel and launches their pack into the
                  world.
                </li>
              </>
            ) : (
              <>
                <li>Install Unlim — no Steam required.</li>
                <li>
                  Friends tab → when they show <strong>Hosting</strong>, hit{" "}
                  <strong>Join</strong>.
                </li>
                <li>
                  Remined connects Unlim and launches their pack into the world.
                </li>
              </>
            )}
          </ol>
        </div>
      </div>
    </Root>
  );
}
