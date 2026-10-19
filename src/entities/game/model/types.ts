export type GamePhase = "idle" | "launching" | "running";

export type LaunchResult = {
  ok: boolean;
  phase: GamePhase;
  message: string;
};

/** An active Open-to-LAN tunnel published through Porthole. */
export type HostingLan = {
  packId: string;
  shareCode: string;
  gamePort: number;
};

/** Parsed `latest.log` status (see `gamewatch.rs`). */
export type GameLiveStatus = {
  phase: string;
  world: string | null;
  server: string | null;
  lan_port: number | null;
};

export type CrashInfo = {
  path: string;
  name: string;
  summary: string;
};
