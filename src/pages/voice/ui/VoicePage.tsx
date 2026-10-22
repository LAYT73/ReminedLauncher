import { useT } from "@/shared/i18n";
import { MSG } from "@/shared/config/messages";
import { NoticePage } from "@/shared/ui/Notice";
import { selectUserId, useSessionStore } from "@/entities/session";

/**
 * Voice tab. The live panel itself is mounted once by the `voice-host` widget
 * (so the session survives navigation); this page only covers the no-voice cases.
 */
export function VoicePage() {
  const t = useT();
  const userId = useSessionStore(selectUserId);
  const offlineMode = useSessionStore((s) => s.offlineMode);
  if (!offlineMode && userId) return null;
  return (
    <NoticePage
      title={t("voice.title")}
      text={offlineMode ? MSG.offline.voice : MSG.offline.voiceSignedOut}
    />
  );
}
