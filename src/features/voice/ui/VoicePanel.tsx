import { useEffect, useMemo, useRef, useState } from "react";
import { useVersionStore } from "@/entities/game-version";
import { usePackStore, useReminePacks } from "@/entities/pack";
import { usePartyStore } from "@/entities/voice-room";
import { t, useT } from "@/shared/i18n";
import { TIMING } from "@/shared/config/timings";
import { useGameBridgeVoice } from "../model/useGameBridgeVoice";
import { usePartyActions } from "../model/usePartyActions";
import { usePartyAutoOpen } from "../model/usePartyAutoOpen";
import { usePartyCommands } from "../model/usePartyCommands";
import { usePartyPublisher } from "../model/usePartyPublisher";
import { usePartyWorldWatch } from "../model/usePartyWorldWatch";
import { usePartyJoinStore } from "../model/partyJoin";
import { partyPackOptions } from "../lib/partyPack";
import { useLiveSession } from "../model/useLiveSession";
import { useRoomData } from "../model/useRoomData";
import { useRuntimeModal } from "../model/useRuntimeModal";
import { useVoiceActions } from "../model/useVoiceActions";
import { useVoiceLists } from "../model/useVoiceLists";
import type { VoicePanelProps } from "../model/types";
import { statusTone } from "./VoiceBits";
import { VoiceDevicesModal } from "./VoiceDevicesModal";
import { PartyCard } from "./PartyCard";
import { PartySwitchBanner } from "./PartySwitchBanner";
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
  party,
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
  useGameBridgeVoice({
    userId,
    room: room.active,
    status: live.status,
    speaking: live.speaking,
    members: room.members,
    muted: live.muted,
    deafened: live.deafened,
    sessionRef: live.sessionRef,
    toggleMute: live.toggleMute,
    toggleDeafen: live.toggleDeafen,
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
  usePartyPublisher({ room: active, userId, isHost });
  usePartyAutoOpen(active, isHost);
  usePartyWorldWatch(active, isHost, members);
  const partyActions = usePartyActions({
    room: active,
    setActive: room.setActive,
    userId,
    isHost,
    members,
    bridge: party,
    onToast,
  });
  const reminePacks = useReminePacks();
  const installedIds = usePackStore((s) => s.installedIds);
  const allPacks = usePackStore((s) => s.packs);
  const versionPicks = useVersionStore((s) => s.by);
  const packOptions = useMemo(
    () => partyPackOptions(reminePacks, active?.packId ?? null),
    // Option sources are read imperatively inside partyPackOptions; these deps refresh them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reminePacks, installedIds, allPacks, versionPicks, active?.packId],
  );
  const partyPackName = packOptions.find((p) => p.id === active?.packId)?.name ?? null;
  const autoOpen = usePartyJoinStore((s) => s.autoOpen);

  // Party snapshot for the friends list (invite / start buttons read it).
  useEffect(() => {
    usePartyStore.getState().setSnapshot({ room: active, isHost, members });
    usePartyStore.getState().pruneInvited();
  }, [active, isHost, members]);
  // Party store is per session: clear it when the panel goes away (sign-out included).
  useEffect(() => () => usePartyStore.getState().reset(), []);
  // Invite chips expire on their own; re-check while the panel is mounted.
  useEffect(() => {
    const id = window.setInterval(() => usePartyStore.getState().pruneInvited(), TIMING.partyStaleTick);
    return () => window.clearInterval(id);
  }, []);

  const [switchTo, setSwitchTo] = useState<string | null>(null);
  /** Deep link into a party while in none: asks before joining. */
  const [joinAsk, setJoinAsk] = useState<{ roomId: string; hostName: string } | null>(null);
  usePartyCommands({
    userId,
    active,
    isHost,
    busy: busy || partyActions.busy || actions.creating,
    onToast,
    onCreate,
    joinRoomById: actions.joinRoomById,
    requestSwitch: setSwitchTo,
    requestJoinConfirm: setJoinAsk,
    primaryKind: partyActions.primary?.kind ?? null,
    onPrimary: partyActions.onPrimary,
  });
  const confirmSwitch = async () => {
    const target = switchTo;
    setSwitchTo(null);
    if (!target) return;
    // onLeave is the only leave step; joinRoomById never leaves on its own.
    await actions.onLeave();
    await actions.joinRoomById(target);
  };
  const confirmJoinAsk = async () => {
    const ask = joinAsk;
    setJoinAsk(null);
    if (ask) await actions.joinRoomById(ask.roomId);
  };
  const joinAskBanner = joinAsk ? (
    <PartySwitchBanner
      isHost={false}
      busy={busy || actions.creating}
      joinAsk={{ hostName: joinAsk.hostName }}
      onConfirm={() => void confirmJoinAsk()}
      onCancel={() => setJoinAsk(null)}
    />
  ) : null;
  const copyPartyLink = () => {
    if (!active) return;
    void navigator.clipboard
      .writeText(`remined://party/${active.id}`)
      .then(() => onToast(t("voice.toasts.linkCopied"), "ok"))
      .catch(() => onToast(t("voice.toasts.linkCopyFailed"), "err"));
  };
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
        toggleMute={live.toggleMute}
        deafened={live.deafened}
        toggleDeafen={live.toggleDeafen}
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
        partyCard={
          <>
            {switchTo ? (
              <PartySwitchBanner
                isHost={isHost}
                busy={busy}
                onConfirm={() => void confirmSwitch()}
                onCancel={() => setSwitchTo(null)}
              />
            ) : null}
            <PartyCard
              room={active}
              isHost={isHost}
              hostName={isHost ? displayName : partyActions.hostName}
              packs={packOptions}
              packName={partyPackName}
              primary={partyActions.primary}
              busy={partyActions.busy}
              canChangePack={partyActions.canChangePack}
              memberCount={members.length}
              autoOpen={autoOpen?.roomId === active.id ? autoOpen : null}
              onPickPack={(id) => void partyActions.pickPack(id)}
              onPrimary={() => void partyActions.onPrimary()}
              onCopyLink={copyPartyLink}
            />
          </>
        }
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
      onCreate={async () => {
        await onCreate();
      }}
      onAcceptInvite={actions.onAcceptInvite}
      onDeclineInvite={actions.onDeclineInvite}
      onRejoin={actions.onRejoin}
      onCloseListedRoom={actions.onCloseListedRoom}
    >
      {modals}
      {joinAskBanner}
    </VoiceLobby>
  );
}
