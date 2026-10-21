/** Tauri event names emitted by the backend. */
export const EVENT = {
  /** Install / launch-prep progress: `{ phase, percent, message }`. */
  progress: "remined-progress",
  /** Voice runtime (LiveKit + Remined Relay) download progress. */
  voiceRuntimeProgress: "voice-runtime-progress",
} as const;
