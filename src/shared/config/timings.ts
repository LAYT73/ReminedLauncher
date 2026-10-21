/** Polling intervals, timeouts and delays (milliseconds). */
export const TIMING = {
  /** `get_game_phase` poll. */
  gamePhasePoll: 700,
  /** `latest.log` live-status poll while the game runs. */
  gameLivePoll: 4_000,
  /** Open-to-LAN watcher poll. */
  lanPoll: 2_000,
  /** A failed host attempt on a port is not retried for this long. */
  lanHostRetryCooldown: 20_000,
  /** Presence heartbeat. */
  presenceHeartbeat: 40_000,
  /** Quiet re-fetch of the friends list. */
  friendsPoll: 12_000,
  /** Pack page screenshot carousel. */
  galleryAutoplay: 6000,
  /** Footer status auto-clear. */
  statusOkTtl: 3_200,
  statusErrorTtl: 6_500,
  /** Boot splash fade-out. */
  bootLeave: 480,
  /** Supabase / network timeouts during boot. */
  catalogFetch: 5_000,
  sessionFetch: 6_000,
  bootstrap: 20_000,
  cloudProfileSync: 8_000,
} as const;
