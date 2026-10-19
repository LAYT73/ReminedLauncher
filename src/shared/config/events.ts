/** Tauri event names emitted by the backend. */
export const EVENT = {
  /** Install / launch-prep progress: `{ phase, percent, message }`. */
  progress: "remined-progress",
  /** Voice runtime (LiveKit + Porthole) download progress. */
  voiceRuntimeProgress: "voice-runtime-progress",
} as const;
