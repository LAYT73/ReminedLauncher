import { createPortal } from "react-dom";
import { FALLBACK_USERNAME } from "@/shared/config/limits";
import { RAIL } from "@/shared/config/routes";
import { toast } from "@/shared/lib/toast";
import { transitionTo } from "@/shared/lib/pageTransition";
import { VoicePanel } from "@/features/voice";
import { joinFriendSession, useJoiningFriend } from "@/features/play-game";
import { useGameStore } from "@/entities/game";
import { useProfileStore } from "@/entities/profile";
import { selectUserId, useSessionStore } from "@/entities/session";
import { useVoiceStatusStore } from "@/entities/voice-room";
import { getVoiceHost } from "../model/host";

/** Keeps the voice session alive for the whole signed-in app lifetime. */
export function VoiceHost() {
  const userId = useSessionStore(selectUserId);
  const username = useProfileStore((s) => s.profile.username);
  const draft = useProfileStore((s) => s.usernameDraft);
  const joiningFriendId = useJoiningFriend((s) => s.id);
  const gameBusy = useGameStore((s) => s.phase !== "idle");
  const { setInRoom, setPendingInvites } = useVoiceStatusStore.getState();

  // Never gate on offlineMode: a brief navigator.onLine blip (common when a
  // peer joins via WebRTC/Relay) used to unmount this portal, disconnect
  // LiveKit, and look like a full launcher reload.
  if (!userId) return null;
  return createPortal(
    <VoicePanel
      userId={userId}
      displayName={(draft ?? username ?? FALLBACK_USERNAME).trim() || FALLBACK_USERNAME}
      onToast={toast}
      onOpenNetworkPlay={() => transitionTo(`/${RAIL.settings}#network`)}
      onRoomStatusChange={setInRoom}
      onInvitesChange={setPendingInvites}
      lanJoin={{
        onJoin: (row) => void joinFriendSession(row),
        joiningFriendId,
        blocked: gameBusy,
      }}
    />,
    getVoiceHost(),
  );
}
