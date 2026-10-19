/**
 * The voice panel renders into this detached node (via a portal) so the LiveKit
 * session survives route changes; `VoiceSlot` moves the node into the visible
 * layout whenever the Voice tab is shown.
 */
let host: HTMLDivElement | null = null;

export function getVoiceHost(): HTMLDivElement {
  if (!host) {
    host = document.createElement("div");
    host.className = "voice-host";
  }
  return host;
}
