export type GamePhase = "idle" | "launching" | "running";

export type LaunchResult = {
  ok: boolean;
  phase: GamePhase;
  message: string;
};

/** An active Open-to-LAN tunnel published through Remined Relay. */
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
  /** Friend-safe code: "" | loading | menu | sp | lan | mp | death | advancement,
   * optionally `base|dim[|paused]` (e.g. "sp|nether|paused") when the companion mod runs. */
  activity: string;
};

export type CrashInfo = {
  path: string;
  name: string;
  summary: string;
};
