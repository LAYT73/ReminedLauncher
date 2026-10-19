import { MSG } from "@/shared/config/messages";
import { toast } from "@/shared/lib/toast";
import { NoticePage } from "@/shared/ui/Notice";
import { NetworkPlayPanel } from "@/features/network-play";
import { useGameStore } from "@/entities/game";
import { useSessionStore } from "@/entities/session";
import { useVoiceStatusStore } from "@/entities/voice-room";

export function NetworkPage() {
  const offlineMode = useSessionStore((s) => s.offlineMode);
  const hostingLan = useGameStore((s) => s.hostingLan);
  const voiceLive = useVoiceStatusStore((s) => s.inRoom);

  if (offlineMode) {
    return <NoticePage title="Network Play" text={MSG.offline.network} />;
  }
  return (
    <NetworkPlayPanel
      hostingSelf={Boolean(hostingLan)}
      hostingPort={hostingLan?.gamePort ?? null}
      voiceLive={voiceLive}
      onToast={toast}
    />
  );
}
