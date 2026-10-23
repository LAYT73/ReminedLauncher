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
  /** Minimum time the boot splash intro plays before it may leave. */
  bootIntroMin: 1_600,
  /** Delay before the first status line starts decoding. */
  bootStatusStart: 600,
  /** Status line decode speed and rotation period. */
  bootDecodeChar: 25,
  bootStatusCycle: 1_800,
  /** Supabase / network timeouts during boot. */
  catalogFetch: 5_000,
  sessionFetch: 6_000,
  bootstrap: 20_000,
  cloudProfileSync: 8_000,
  /** Page transition tile wipe: cover, reveal, forced completion. */
  pageCover: 360,
  pageReveal: 520,
  /** Playbar slide in / out when entering or leaving a pack rail. */
  playbarSlide: 360,
  pageSafety: 2_000,
  /** Voice room chat safety-net re-fetch. */
  voiceChatPoll: 12_000,
  /** Voice room closed-state check while a room is open. */
  voiceRoomStatusPoll: 4_000,
  /** Re-check of the host's Relay key while a guest joins. */
  hostKeyPoll: 500,
  /** Browser-offline grace before the app switches to offline mode. */
  offlineGrace: 2_500,
  /** Default online probe timeout. */
  networkProbe: 2_500,
  /** Presence activity change debounce. */
  activityDebounce: 5_000,
} as const;
