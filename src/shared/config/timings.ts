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
  /** Min gap between party member progress writes (install %). */
  partyProgressThrottle: 2_000,
  /** Voice room closed-state check while a room is open. */
  voiceRoomStatusPoll: 4_000,
  /** Re-check of the host's Relay key while a guest joins. */
  hostKeyPoll: 500,
  /** Browser-offline grace before the app switches to offline mode. */
  offlineGrace: 2_500,
  /** Default online probe timeout. */
  networkProbe: 2_500,
  /** A pack deep link waits this long for the catalog before it is dropped. */
  deepLinkPackWait: 15_000,
  /** Presence activity change debounce. */
  activityDebounce: 5_000,
  /** Party host: how long the mod may take to answer open_lan. */
  partyOpenReply: 15_000,
  /** Party host: after open_lan ok, how long until the game log shows the LAN port. */
  partyOpenConfirm: 20_000,
  /** Party write retry: first delay, doubling per failure, capped. */
  partyRetryMin: 2_000,
  partyRetryMax: 30_000,
  /** Party member heartbeat: re-write my state so updated_at stays fresh. */
  partyHeartbeat: 60_000,
  /** A member row older than this is stale: shown as joined, host treated as offline. */
  partyStaleAfter: 180_000,
  /** Party "Invited" chip expires after this, so the host can invite again. */
  partyInviteTtl: 120_000,
  /** Re-render tick for stale-member checks while in a party. */
  partyStaleTick: 30_000,
} as const;
