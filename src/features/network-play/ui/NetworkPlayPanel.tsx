import { open } from "@tauri-apps/plugin-dialog";
import { Fragment, type ReactNode } from "react";
import { useT } from "@/shared/i18n";
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

/** Renders `<b>…</b>` segments of a translated string as <strong>. */
function rich(text: string): ReactNode {
  return text.split(/<b>(.*?)<\/b>/g).map((part, i) =>
    i % 2 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

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
  const t = useT();
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
      ? t("network.panel.checking")
      : relay.check
        ? relay.check.ok
          ? t("network.panel.ready")
          : relayInstalled
            ? t("network.panel.issue")
            : t("network.panel.missing")
        : relayInstalled
          ? relay.status.version
            ? `v${relay.status.version}`
            : t("network.panel.found")
          : t("network.panel.missing");

  const relayStatusClass = relay.check
    ? relay.check.ok
      ? "is-ready"
      : "is-missing"
    : relayInstalled
      ? "is-ready"
      : "is-missing";
  const relayTitle = relay.check
    ? relay.check.ok
      ? t("network.panel.readyForVoiceLan")
      : t("network.panel.needsAttention")
    : relayInstalled
      ? t("network.panel.foundTitle")
      : t("network.panel.notFound");
  const relayBody = relay.checking
    ? t("network.panel.checkingRelay")
    : relay.check
      ? relay.check.message
      : relayInstalled
        ? relay.status?.path ?? t("network.panel.binaryFound")
        : t("network.panel.tapCheck");

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
        {embedded ? null : <h2 className="page-title">{t("network.panel.title")}</h2>}
        <div className="network-status-badges" aria-live="polite">
          <StatusBadge label={t("network.panel.relayLabel")} value={relayValue} tone={relayTone} />
        </div>
      </div>

      {voiceLive ? (
        <p className="friends-lead">
          {t("network.panel.voiceLive")}
        </p>
      ) : null}

      <div className="network-relay">
        <h3 className="settings-heading">{t("network.panel.relayHeading")}</h3>
        <p className="friends-lead">
          {rich(t("network.panel.relayLead"))}
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
                {t("network.panel.getFrpc")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn-mc ok"
              disabled={relay.busy || relay.checking}
              onClick={() => void relay.runCheck()}
            >
              {relay.checking ? t("network.panel.checkingBtn") : t("network.panel.check")}
            </button>
            <button
              type="button"
              className="btn-mc dim"
              disabled={relay.busy || relay.checking}
              onClick={() => void relay.refresh()}
            >
              {t("network.panel.refresh")}
            </button>
            {relayInstalled ? (
              <button
                type="button"
                className="btn-mc dim"
                disabled={relay.busy || relay.checking}
                onClick={() => void relay.openDownload()}
              >
                {t("network.panel.frpReleases")}
              </button>
            ) : null}
          </div>
        </div>
        {relay.error ? <p className="friends-error">{relay.error}</p> : null}
        {relay.check && !relay.check.ok && relay.check.detail ? (
          <pre className="network-check-detail">{relay.check.detail}</pre>
        ) : null}

        <div className="field">
          <label htmlFor="relay-path">{t("network.panel.frpcBinary")}</label>
          <div className="field-row">
            <input
              id="relay-path"
              type="text"
              spellCheck={false}
              placeholder={t("network.panel.autoDetect")}
              value={relay.pathDraft}
              onChange={(e) => relay.setPathDraft(e.target.value)}
              onBlur={() => {
                const next = relay.pathDraft.trim();
                void relay.savePath(next || null);
              }}
            />
            <FolderIconBtn
              title={t("network.panel.browse")}
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
                {t("network.panel.auto")}
              </button>
            ) : null}
          </div>
          <p className="field-hint">
            {t("network.panel.pathHint")}
          </p>
        </div>
      </div>

      {hostingSelf ? (
        <p className="friends-hosting-banner" role="status">
          {hostingPort
            ? t("network.panel.hostingBannerPort", { port: hostingPort })
            : t("network.panel.hostingBanner")}
        </p>
      ) : null}

      <div className="network-steps">
        <div className="network-step">
          <h3 className="settings-heading">{t("network.panel.hostHeading")}</h3>
          <ol>
            <li>{t("network.panel.hostStep1")}</li>
            <li>{rich(t("network.panel.hostStep2"))}</li>
            <li>{rich(t("network.panel.hostStep3"))}</li>
          </ol>
        </div>
        <div className="network-step">
          <h3 className="settings-heading">{t("network.panel.joinHeading")}</h3>
          <ol>
            <li>{rich(t("network.panel.joinStep1"))}</li>
            <li>{t("network.panel.joinStep2")}</li>
          </ol>
        </div>
      </div>
    </Root>
  );
}
