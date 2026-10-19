import { createPortal } from "react-dom";
import { FALLBACK_USERNAME } from "@/shared/config/limits";
import { TAB, routeFor } from "@/shared/config/routes";
import { toast } from "@/shared/lib/toast";
import { useRail } from "@/shared/lib/useRoute";
import { useNavigate } from "react-router";
import { VoicePanel } from "@/features/voice";
import { useProfileStore } from "@/entities/profile";
import { selectUserId, useSessionStore } from "@/entities/session";
import { useVoiceStatusStore } from "@/entities/voice-room";
import { getVoiceHost } from "../model/host";

/** Keeps the voice session alive for the whole signed-in, online app lifetime. */
export function VoiceHost() {
  const navigate = useNavigate();
  const rail = useRail();
  const userId = useSessionStore(selectUserId);
  const offlineMode = useSessionStore((s) => s.offlineMode);
  const username = useProfileStore((s) => s.profile.username);
  const draft = useProfileStore((s) => s.usernameDraft);
  const { setInRoom, setPendingInvites } = useVoiceStatusStore.getState();

  if (offlineMode || !userId) return null;
  return createPortal(
    <VoicePanel
      userId={userId}
      displayName={(draft ?? username ?? FALLBACK_USERNAME).trim() || FALLBACK_USERNAME}
      onToast={toast}
      onOpenNetworkPlay={() => navigate(routeFor(rail, TAB.network))}
      onRoomStatusChange={setInRoom}
      onInvitesChange={setPendingInvites}
    />,
    getVoiceHost(),
  );
}
