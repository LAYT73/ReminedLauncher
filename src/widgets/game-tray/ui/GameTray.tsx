import { useEffect, useState } from "react";
import { revealPath } from "@/features/manage-installations";
import { useGameStore, type GameLiveStatus, type GamePhase } from "@/entities/game";
import {
  fetchPublicIpv4,
  isLoopbackHost,
  normalizeServerAddress,
} from "@/shared/lib/publicIp";
import { useT, type TFunction } from "@/shared/i18n";
import { toast } from "@/shared/lib/toast";
import { activityLabel } from "@/shared/lib/activityLabel";

type Chip = {
  label: string;
  /** Copied on click; also shown as the value when set. */
  value?: string;
  copyText?: string;
  title?: string;
  /** Rich activity (dimension / paused) from the companion mod. */
  extra?: string;
};

function buildChip(
  t: TFunction,
  phase: GamePhase,
  live: GameLiveStatus | null,
  publicIp: string | null,
): Chip | null {
  if (phase === "launching") return { label: t("shell.tray.launching") };
  if (phase !== "running" || !live || live.phase === "none") return null;

  // Singleplayer world still starting up (activity "loading" while phase is "world").
  if (live.phase === "world" && live.activity === "loading") {
    return { label: t("shell.tray.loading"), value: live.world || undefined };
  }

  switch (live.phase) {
    case "loading":
      return { label: t("shell.tray.loading") };
    case "menu":
      return { label: t("shell.tray.inMenu") };
    case "lan": {
      const port = live.lan_port;
      if (!port) return { label: t("shell.tray.hostingLan") };
      const host = publicIp || "…";
      const addr = `${host}:${port}`;
      return {
        label: t("shell.tray.lan"),
        value: addr,
        copyText: publicIp ? addr : undefined,
        title: publicIp
          ? t("shell.tray.copyPublic")
          : t("shell.tray.resolvingIp"),
      };
    }
    case "server": {
      const raw = live.server?.trim();
      if (!raw) return { label: t("shell.tray.server") };
      const addr = normalizeServerAddress(raw);
      const [host, port] = addr.split(":");
      // Connected through the Relay loopback — show WAN:port when known.
      if (host && port && isLoopbackHost(host) && publicIp) {
        const pub = `${publicIp}:${port}`;
        return {
          label: t("shell.tray.server"),
          value: pub,
          copyText: pub,
          title: t("shell.tray.copyTunnel"),
        };
      }
      return {
        label: t("shell.tray.server"),
        value: addr,
        copyText: addr,
        title: t("shell.tray.copyAddress"),
      };
    }
    default:
      return {
        label: t("shell.tray.world"),
        value: live.world || undefined,
      };
  }
}

/** Live game-status pill + "crash report" shortcut shown in the top nav. */
export function GameTray() {
  const t = useT();
  const phase = useGameStore((s) => s.phase);
  const live = useGameStore((s) => s.live);
  const crash = useGameStore((s) => s.crash);
  const [publicIp, setPublicIp] = useState<string | null>(null);

  const wantsPublicIp =
    phase === "running" &&
    (live?.phase === "lan" ||
      (live?.phase === "server" &&
        Boolean(live.server && isLoopbackHost(normalizeServerAddress(live.server).split(":")[0] || ""))));

  useEffect(() => {
    if (!wantsPublicIp) return;
    let stop = false;
    void fetchPublicIpv4().then((ip) => {
      if (!stop && ip) setPublicIp(ip);
    });
    return () => {
      stop = true;
    };
  }, [wantsPublicIp]);

  const base = buildChip(t, phase, live, publicIp);
  const extra =
    phase === "running" && live?.activity?.includes("|")
      ? activityLabel(live.activity)
      : undefined;
  const chip = base && extra ? { ...base, extra } : base;

  if (!chip && !crash) return null;

  return (
    <div className="game-tray">
      {chip ? (
        chip.copyText ? (
          <button
            type="button"
            className="network-pill is-ok"
            title={chip.title || t("shell.tray.copy")}
            onClick={() => {
              void navigator.clipboard.writeText(chip.copyText!).then(
                () => toast(t("shell.tray.copied"), "ok"),
                () => toast(t("shell.tray.copyFailed"), "err"),
              );
            }}
          >
            <span className="network-pill-dot" aria-hidden />
            <span className="network-pill-label">{chip.label}</span>
            {chip.value ? (
              <span className="network-pill-value">{chip.value}</span>
            ) : null}
            {chip.extra ? (
              <span className="network-pill-value">{chip.extra}</span>
            ) : null}
          </button>
        ) : (
          <span className="network-pill is-ok" title={chip.title || t("shell.tray.liveStatus")}>
            <span className="network-pill-dot" aria-hidden />
            <span className="network-pill-label">{chip.label}</span>
            {chip.value ? (
              <span className="network-pill-value">{chip.value}</span>
            ) : null}
            {chip.extra ? (
              <span className="network-pill-value">{chip.extra}</span>
            ) : null}
          </span>
        )
      ) : null}
      {crash ? (
        <button
          type="button"
          className="network-pill is-bad"
          title={t("shell.tray.crashTitle", { summary: crash.summary })}
          onClick={() => {
            revealPath(crash.path);
            useGameStore.getState().setCrash(null);
          }}
        >
          <span className="network-pill-dot" aria-hidden />
          <span className="network-pill-label">{t("shell.tray.crashReport")}</span>
        </button>
      ) : null}
    </div>
  );
}
