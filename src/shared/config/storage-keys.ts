/** localStorage keys. Bump the suffix when the stored shape changes. */
export const STORAGE_KEY = {
  offlineCache: "remined.offline.v1",
  lastPlayed: "remined.lastPlayed.v1",
  /** Per-user pack playtime cache: `${prefix}${userId}`. */
  packPlaytimePrefix: "remined.packPlaytime.v1.",
  dismissedNotes: "remined.dismissedNotes.v1",
  achievementPrefix: "remined.ach.",
  gameBridge: "remined.gameBridge",
  shareActivity: "remined.shareActivity",
  pageTransition: "remined.pageTransition",
  voiceDevices: "remined.voice.devices",
  friendToast: "remined.friend-toast",
  locale: "remined.locale",
  /** Native notifications while the launcher is in the background (`"0"` = off). */
  systemNotify: "remined.systemNotify",
} as const;
