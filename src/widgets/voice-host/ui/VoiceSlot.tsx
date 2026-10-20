import { TAB } from "@/shared/config/routes";
import { useRoute } from "@/shared/lib/useRoute";
import { selectUserId, useSessionStore } from "@/entities/session";
import { getVoiceHost } from "../model/host";

/** Visible mount point of the voice panel; hidden unless the Voice tab is open. */
export function VoiceSlot() {
  const { tab } = useRoute();
  const userId = useSessionStore(selectUserId);
  if (!userId) return null;
  return (
    <div
      className={`voice-slot${tab === TAB.voice ? " is-open" : ""}`}
      ref={(el) => {
        const host = getVoiceHost();
        if (el && host.parentElement !== el) el.appendChild(host);
      }}
    />
  );
}
