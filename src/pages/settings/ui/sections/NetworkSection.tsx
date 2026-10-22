import { MSG } from "@/shared/config/messages";
import { useT } from "@/shared/i18n";
import { toast } from "@/shared/lib/toast";
import { NetworkPlayPanel } from "@/features/network-play";
import { useGameStore } from "@/entities/game";
import { useSessionStore } from "@/entities/session";
import { useVoiceStatusStore } from "@/entities/voice-room";

/** Remined Relay / Network Play setup. */
export function NetworkSection() {
  useT();
  const offlineMode = useSessionStore((s) => s.offlineMode);
  const hostingLan = useGameStore((s) => s.hostingLan);
  const voiceLive = useVoiceStatusStore((s) => s.inRoom);

  return (
    <div className="settings-block" id="settings-network">
      {offlineMode ? (
        <p className="field-hint">{MSG.offline.network}</p>
      ) : (
        <NetworkPlayPanel
          hostingSelf={Boolean(hostingLan)}
          hostingPort={hostingLan?.gamePort ?? null}
          voiceLive={voiceLive}
          onToast={toast}
          embedded
        />
      )}
    </div>
  );
}
