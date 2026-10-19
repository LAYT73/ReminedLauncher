/** localStorage keys. Bump the suffix when the stored shape changes. */
export const STORAGE_KEY = {
  offlineCache: "remined.offline.v1",
  lastPlayed: "remined.lastPlayed.v1",
  /** Per-user pack playtime cache: `${prefix}${userId}`. */
  packPlaytimePrefix: "remined.packPlaytime.v1.",
  voicePtt: "remined.voice.ptt",
  dismissedNotes: "remined.dismissedNotes.v1",
  achievementPrefix: "remined.ach.",
} as const;
