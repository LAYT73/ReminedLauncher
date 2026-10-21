import { useEffect, useState } from "react";
import { revealPath } from "@/features/manage-installations";
import { useGameStore, type GameLiveStatus, type GamePhase } from "@/entities/game";
import {
  fetchPublicIpv4,
  isLoopbackHost,
  normalizeServerAddress,
} from "@/shared/lib/publicIp";
import { toast } from "@/shared/lib/toast";

type Chip = {
  label: string;
  /** Copied on click; also shown as the value when set. */
  value?: string;
  copyText?: string;
  title?: string;
};

function buildChip(
  phase: GamePhase,
  live: GameLiveStatus | null,
  publicIp: string | null,
): Chip | null {
  if (phase === "launching") return { label: "Launching" };
  if (phase !== "running" || !live || live.phase === "none") return null;

  switch (live.phase) {
    case "loading":
      return { label: "Loading" };
    case "menu":
      return { label: "In menu" };
    case "lan": {
      const port = live.lan_port;
      if (!port) return { label: "Hosting LAN" };
      const host = publicIp || "…";
      const addr = `${host}:${port}`;
      return {
        label: "LAN",
        value: addr,
        copyText: publicIp ? addr : undefined,
        title: publicIp
          ? "Click to copy public address (port-forward / direct connect)"
          : "Resolving public IP…",
      };
    }
    case "server": {
      const raw = live.server?.trim();
      if (!raw) return { label: "Server" };
      const addr = normalizeServerAddress(raw);
      const [host, port] = addr.split(":");
      // Connected through the Relay loopback — show WAN:port when known.
      if (host && port && isLoopbackHost(host) && publicIp) {
        const pub = `${publicIp}:${port}`;
        return {
          label: "Server",
          value: pub,
          copyText: pub,
          title: "Click to copy (local tunnel is 127.0.0.1; showing public IP)",
        };
      }
      return {
        label: "Server",
        value: addr,
        copyText: addr,
        title: "Click to copy address",
      };
    }
    default:
      return {
        label: "World",
        value: live.world || undefined,
      };
  }
}

/** Live game-status pill + "crash report" shortcut shown in the top nav. */
export function GameTray() {
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

  const chip = buildChip(phase, live, publicIp);

  if (!chip && !crash) return null;

  return (
    <div className="game-tray">
      {chip ? (
        chip.copyText ? (
          <button
            type="button"
            className="network-pill is-ok"
            title={chip.title || "Click to copy"}
            onClick={() => {
              void navigator.clipboard.writeText(chip.copyText!).then(
                () => toast("Copied address", "ok"),
                () => toast("Could not copy", "err"),
              );
            }}
          >
            <span className="network-pill-dot" aria-hidden />
            <span className="network-pill-label">{chip.label}</span>
            {chip.value ? (
              <span className="network-pill-value">{chip.value}</span>
            ) : null}
          </button>
        ) : (
          <span className="network-pill is-ok" title={chip.title || "Live game status"}>
            <span className="network-pill-dot" aria-hidden />
            <span className="network-pill-label">{chip.label}</span>
            {chip.value ? (
              <span className="network-pill-value">{chip.value}</span>
            ) : null}
          </span>
        )
      ) : null}
      {crash ? (
        <button
          type="button"
          className="network-pill is-bad"
          title={`${crash.summary} — click to show the crash report`}
          onClick={() => {
            revealPath(crash.path);
            useGameStore.getState().setCrash(null);
          }}
        >
          <span className="network-pill-dot" aria-hidden />
          <span className="network-pill-label">Crash report</span>
        </button>
      ) : null}
    </div>
  );
}
