import { useMemo, useState } from "react";
import { useLiveSession } from "../model/useLiveSession";
import { usePushToTalkState } from "../model/usePushToTalkState";
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
}: VoicePanelProps) {
  const [devicesOpen, setDevicesOpen] = useState(false);
  const lists = useVoiceLists(userId, onToast, onInvitesChange);
  const room = useRoomData(userId, displayName);
  const live = useLiveSession({
    userId,
    displayName,
    onToast,
    onRoomStatusChange,
    setMembers: room.setMembers,
  });
  const { ptt, setPtt, pttDown } = usePushToTalkState(
    Boolean(room.active),
    live.muted,
    live.sessionRef,
    onToast,
  );
  const runtime = useRuntimeModal();
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
          label: f.profile.username || "Friend",
          hint: f.profile.remined_id ? `#${f.profile.remined_id}` : undefined,
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
      onClose={() => setDevicesOpen(false)}
      onApply={(mic, out) => {
        live.setMicId(mic);
        live.setOutputId(out);
        if (mic) void sessionRef.current?.switchMic(mic);
        if (out) void sessionRef.current?.switchOutput(out);
        onToast("Devices updated", "ok");
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
        videoTiles={live.videoTiles}
        speaking={live.speaking}
        volumes={live.volumes}
        setVolumes={live.setVolumes}
        muted={live.muted}
        setMuted={live.setMuted}
        deafened={live.deafened}
        setDeafened={live.setDeafened}
        ptt={ptt}
        setPtt={setPtt}
        pttDown={pttDown}
        camOn={live.camOn}
        screenOn={live.screenOn}
        inviteOptions={inviteOptions}
        invitePick={actions.invitePick}
        setInvitePick={actions.setInvitePick}
        draft={actions.draft}
        setDraft={actions.setDraft}
        chatEndRef={chatEndRef}
        onToast={onToast}
        onOpenNetworkPlay={onOpenNetworkPlay}
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
