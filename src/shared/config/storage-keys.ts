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
  /** Schematics tab: last opened schematic id. */
  schematicsLast: "remined.schematics.last.v1",
  /** Schematics tab: view toggles (JSON). */
  schematicsView: "remined.schematics.view.v2",
  /** Schematics tab: collapsed sidebars (JSON {left,right}). */
  schematicsCollapsed: "remined.schematics.collapsed.v1",
  /** Schematics tab: right panel tab / materials scope. */
  schematicsPanel: "remined.schematics.panel.v1",
  /** Schematics tab: measuring tape tool on/off. */
  schematicsTape: "remined.schematics.tape.v1",
  /** Schematics tab: left panel source ("mine" | "catalog"). */
  schematicsSource: "remined.schematics.source.v1",
  /** Current layer per schematic: `${prefix}${id}`. */
  schematicsLayerPrefix: "remined.schematics.layer.v1.",
} as const;
