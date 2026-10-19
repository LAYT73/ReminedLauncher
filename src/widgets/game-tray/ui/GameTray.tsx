import { revealPath } from "@/features/manage-installations";
import { useGameStore, type GameLiveStatus, type GamePhase } from "@/entities/game";

function liveLabel(phase: GamePhase, live: GameLiveStatus | null): string | null {
  if (phase === "running" && live && live.phase !== "none") {
    switch (live.phase) {
      case "loading":
        return "Loading";
      case "menu":
        return "In menu";
      case "lan":
        return `Hosting LAN${live.lan_port ? ` :${live.lan_port}` : ""}`;
      case "server":
        return `Server${live.server ? `: ${live.server}` : ""}`;
      default:
        return `World${live.world ? `: ${live.world}` : ""}`;
    }
  }
  return phase === "launching" ? "Launching" : null;
}

/** Live game-status pill + "crash report" shortcut shown in the top nav. */
export function GameTray() {
  const phase = useGameStore((s) => s.phase);
  const live = useGameStore((s) => s.live);
  const crash = useGameStore((s) => s.crash);
  const label = liveLabel(phase, live);
  if (!label && !crash) return null;
  return (
    <div className="game-tray">
      {label ? (
        <span className="network-pill is-ok" title="Live game status">
          <span className="network-pill-dot" aria-hidden />
          <span className="network-pill-label">{label}</span>
        </span>
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
