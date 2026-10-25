/** Tauri event names emitted by the backend. */
export const EVENT = {
  /** Install / launch-prep progress: `{ phase, percent, message }`. */
  progress: "remined-progress",
  /** Voice runtime (LiveKit + Remined Relay) download progress. */
  voiceRuntimeProgress: "voice-runtime-progress",
  /** In-game companion bridge: `{ t, ... }` JSON lines from the mod. */
  gameBridge: "game-bridge",
  /** In-game companion bridge connection: `{ connected }`. */
  gameBridgeStatus: "game-bridge-status",
  /** `remined://` URL opened while the launcher runs (or queued from a cold start): raw string. */
  deepLink: "deep-link",
} as const;
