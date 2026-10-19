import { TAB } from "@/shared/config/routes";
import { useRoute } from "@/shared/lib/useRoute";
import { selectUserId, useSessionStore } from "@/entities/session";
import { getVoiceHost } from "../model/host";

/** Visible mount point of the voice panel; hidden unless the Voice tab is open. */
export function VoiceSlot() {
  const { tab } = useRoute();
  const userId = useSessionStore(selectUserId);
  const offlineMode = useSessionStore((s) => s.offlineMode);
  if (offlineMode || !userId) return null;
  return (
    <div
      className="voice-slot"
      style={{ display: tab === TAB.voice ? "block" : "none" }}
      ref={(el) => {
        const host = getVoiceHost();
        if (el && host.parentElement !== el) el.appendChild(host);
      }}
    />
  );
}
