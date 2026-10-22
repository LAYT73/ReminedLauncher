import { useMemo, useRef, useState } from "react";
import { t, useT } from "@/shared/i18n";
import { useLiveSession } from "../model/useLiveSession";
import { useRoomData } from "../model/useRoomData";
import { useRuntimeModal } from "../model/useRuntimeModal";
import { useVoiceActions } from "../model/useVoiceActions";
import { useVoiceLists } from "../model/useVoiceLists";
import type { VoicePanelProps } from "../model/types";
import { statusTone } from "./VoiceBits";
import { VoiceDevicesModal } from "./VoiceDevicesModal";
import { VoiceLobby } from "./VoiceLobby";
import { VoiceRoomView } from "./VoiceRoomView";
import { VoiceRuntimeModal } from "./VoiceRuntimeModal";

export function VoicePanel({
  userId,
  displayName,
  onToast,
  onOpenNetworkPlay,
  onRoomStatusChange,
  onInvitesChange,
  lanJoin,
}: VoicePanelProps) {
  useT(); // re-render on locale change (status tone, labels)
  const [devicesOpen, setDevicesOpen] = useState(false);
  const lists = useVoiceLists(userId, onToast, onInvitesChange);
  const room = useRoomData(userId, displayName);
  const runtime = useRuntimeModal();
  const activeRoomIdRef = useRef<string | null>(null);
  activeRoomIdRef.current = room.active?.id ?? null;
  const kickRef = useRef<(roomId: string) => Promise<void>>(async () => undefined);
  const live = useLiveSession({
    userId,
    displayName,
    onToast,
    onRoomStatusChange,
    setMembers: room.setMembers,
    onHostShareCodeRepublished: (roomId, shareCode) => {
      room.setActive((prev) =>
        prev && prev.id === roomId
          ? { ...prev, relayShareCode: shareCode }
          : prev,
      );
    },
    onRoomEnded: () => {
      const id = activeRoomIdRef.current;
      if (id) void kickRef.current(id);
    },
  });
  const actions = useVoiceActions({
    userId,
    displayName,
    onToast,
    onRoomStatusChange,
    room,
    live,
    lists,
    runtime,
  });
  kickRef.current = (roomId) => actions.kickGuestRoomEnded(roomId);
  const { active, members, messages, chatEndRef } = room;
  const { friends, rooms, invites, listsLoading } = lists;
  const { sessionRef, micId, outputId, status } = live;
  const { busy, isHost, onCreate } = actions;
  const runtimeModal = runtime.state;
  const closeRuntimeModal = runtime.close;

  const inviteOptions = useMemo(
    () =>
      friends
        .filter((f) => f.direction === "friend")
        .map((f) => ({
          id: f.profile.id,
          label: f.profile.username || t("social.presence.friendFallback"),
          hint: f.profile.remined_id ? `#${f.profile.remined_id}` : undefined,
          skinUrl: f.profile.skin_path ?? null,
        })),
    [friends],
  );
  const tone = statusTone(status);

  const devicesModal = (
    <VoiceDevicesModal
      open={devicesOpen}
      session={sessionRef.current}
      micId={micId}
      outputId={outputId}
      camId={live.camId}
      onClose={() => setDevicesOpen(false)}
      onApply={(mic, out, cam) => {
        void live.saveDevices(mic, out, cam);
        onToast(t("voice.devicesModal.updated"), "ok");
      }}
    />
  );

  const runtimeUi = (
    <VoiceRuntimeModal
      state={runtimeModal}
      onClose={closeRuntimeModal}
      onRetry={() => {
        if (busy || active) {
          closeRuntimeModal();
          return;
        }
        closeRuntimeModal();
        void onCreate();
      }}
    />
  );

  const modals = (
    <>
      {devicesModal}
      {runtimeUi}
    </>
  );

  if (active) {
    return (
      <VoiceRoomView
        userId={userId}
        active={active}
        session={sessionRef.current}
        isHost={isHost}
        busy={busy}
        status={status}
        tone={tone}
        invites={invites}
        members={members}
        messages={messages}
        lanJoin={lanJoin}
        videoTiles={live.videoTiles}
        speaking={live.speaking}
        volumes={live.volumes}
        setVolumes={live.setVolumes}
        muted={live.muted}
        setMuted={live.setMuted}
        deafened={live.deafened}
        setDeafened={live.setDeafened}
        camOn={live.camOn}
        screenOn={live.screenOn}
        needsAudioUnlock={live.needsAudioUnlock}
        unlockAudio={live.unlockAudio}
        inviteOptions={inviteOptions}
        invitePick={actions.invitePick}
        setInvitePick={actions.setInvitePick}
        draft={actions.draft}
        setDraft={actions.setDraft}
        chatEndRef={chatEndRef}
        setDevicesOpen={setDevicesOpen}
        toggleCamera={live.toggleCamera}
        toggleScreen={live.toggleScreen}
        onAcceptInvite={actions.onAcceptInvite}
        onDeclineInvite={actions.onDeclineInvite}
        onInvite={actions.onInvite}
        onLeave={actions.onLeave}
        onSend={actions.onSend}
      >
        {modals}
      </VoiceRoomView>
    );
  }

  return (
    <VoiceLobby
      userId={userId}
      status={status}
      tone={tone}
      title={actions.title}
      setTitle={actions.setTitle}
      busy={busy}
      creating={actions.creating}
      listsLoading={listsLoading}
      invites={invites}
      rooms={rooms}
      onToast={onToast}
      onOpenNetworkPlay={onOpenNetworkPlay}
      setDevicesOpen={setDevicesOpen}
      onCreate={onCreate}
      onAcceptInvite={actions.onAcceptInvite}
      onDeclineInvite={actions.onDeclineInvite}
      onRejoin={actions.onRejoin}
      onCloseListedRoom={actions.onCloseListedRoom}
    >
      {modals}
    </VoiceLobby>
  );
}
