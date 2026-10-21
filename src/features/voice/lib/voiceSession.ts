import {
  ConnectionError,
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type LocalAudioTrack,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from "livekit-client";
import { voiceLog, voiceLogPath, voiceMintToken } from "../api/voiceNative";
import { installRtcDiagnostics } from "./rtcDiagnostics";


export type VoiceSessionCallbacks = {
  onParticipants?: () => void;
  onSpeaking?: (identity: string, speaking: boolean) => void;
  onDisconnected?: () => void;
  onError?: (message: string) => void;
  /** Camera / screen-share tracks changed (local or remote). */
  onVideo?: () => void;
  /** LiveKit autoplay gate — false means UI should offer a click-to-hear fallback. */
  onAudioPlayback?: (canPlay: boolean) => void;
  /** Remote peer left LiveKit — host may prune stale Supabase membership. */
  onRemoteLeft?: (identity: string) => void;
  /** Remote peer (re)joined LiveKit — cancel a pending membership prune. */
  onRemoteJoined?: (identity: string) => void;
};

export type VoiceVideoTile = {
  identity: string;
  source: "camera" | "screen";
  track: Track;
  local: boolean;
};

export type VoiceParticipantState = { muted: boolean; deafened: boolean };

export class VoiceSession {
  room: Room | null = null;
  localTrack: LocalAudioTrack | null = null;
  private muted = false;
  private deafened = false;
  private cbs: VoiceSessionCallbacks;
  private volumes = new Map<string, number>();
  private outputDeviceId: string | undefined;
  private resumeBound: (() => void) | null = null;
  private pointerBound: (() => void) | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private resumeTimers: ReturnType<typeof setTimeout>[] = [];

  constructor(cbs: VoiceSessionCallbacks = {}) {
    this.cbs = cbs;
  }

  /** Burst of resume attempts — WebView often needs a beat after cam/focus. */
  scheduleResume() {
    for (const t of this.resumeTimers) clearTimeout(t);
    this.resumeTimers = [];
    for (const ms of [0, 200, 600, 1500]) {
      this.resumeTimers.push(setTimeout(() => void this.resumePlayback(), ms));
    }
  }

  /**
   * Unlock playback and ensure each remote audio track is attached once.
   * Never detach/reattach here — that races WKWebView WebRTC and crashes
   * WebContent (PAC) when a guest joins.
   */
  async resumePlayback() {
    const room = this.room;
    if (!room) return;
    try {
      await room.startAudio();
    } catch {
      /* autoplay policies vary */
    }
    for (const p of room.remoteParticipants.values()) {
      this.ensureRemoteAudioAttached(p);
    }
    this.applyAllVolumes();
    this.cbs.onAudioPlayback?.(room.canPlaybackAudio);
  }

  /**
   * webAudioMix still needs one HTMLMediaElement attach to wire GainNode →
   * speakers. Without attach, speaking indicators work but you hear silence.
   */
  private ensureRemoteAudioAttached(participant: RemoteParticipant) {
    for (const pub of participant.audioTrackPublications.values()) {
      const track = pub.track;
      if (!track || track.kind !== Track.Kind.Audio) continue;
      const already = track.attachedElements?.some(
        (el) => el instanceof HTMLAudioElement,
      );
      if (already) continue;
      try {
        const attached = track.attach();
        const els = Array.isArray(attached) ? attached : [attached];
        for (const el of els) {
          if (!(el instanceof HTMLAudioElement)) continue;
          el.dataset.identity = participant.identity;
          el.autoplay = true;
          el.style.display = "none";
          if (!el.isConnected) document.body.appendChild(el);
          if (this.outputDeviceId && "setSinkId" in el) {
            void (
              el as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }
            )
              .setSinkId(this.outputDeviceId)
              .catch(() => undefined);
          }
          void el.play().catch(() => undefined);
        }
      } catch {
        /* attach optional per track */
      }
    }
    this.applyRemoteVolume(participant.identity);
  }

  private applyRemoteVolume(identity: string) {
    const p = this.room?.remoteParticipants.get(identity);
    if (!p) return;
    const v = this.deafened ? 0 : (this.volumes.get(identity) ?? 1);
    try {
      p.setVolume(v);
    } catch {
      /* ignore */
    }
  }

  private applyAllVolumes() {
    const room = this.room;
    if (!room) return;
    for (const p of room.remoteParticipants.values()) {
      this.applyRemoteVolume(p.identity);
    }
  }

  private wireResumeHooks() {
    this.unwireResumeHooks();
    const onResume = () => this.scheduleResume();
    // Immediate startAudio while the gesture is still active (delayed retries lose it).
    const onPointer = () => {
      const room = this.room;
      if (room && !room.canPlaybackAudio) void this.resumePlayback();
      else onResume();
    };
    this.resumeBound = onResume;
    this.pointerBound = onPointer;
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);
    window.addEventListener("pageshow", onResume);
    document.addEventListener("pointerdown", onPointer, { passive: true });
    navigator.mediaDevices?.addEventListener?.("devicechange", onResume);
    this.watchdog = setInterval(() => {
      const room = this.room;
      if (!room || room.state !== ConnectionState.Connected) return;
      if (!room.canPlaybackAudio) void this.resumePlayback();
    }, 3500);
  }

  private unwireResumeHooks() {
    if (this.resumeBound) {
      document.removeEventListener("visibilitychange", this.resumeBound);
      window.removeEventListener("focus", this.resumeBound);
      window.removeEventListener("pageshow", this.resumeBound);
      navigator.mediaDevices?.removeEventListener?.(
        "devicechange",
        this.resumeBound,
      );
      this.resumeBound = null;
    }
    if (this.pointerBound) {
      document.removeEventListener("pointerdown", this.pointerBound);
      this.pointerBound = null;
    }
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    for (const t of this.resumeTimers) clearTimeout(t);
    this.resumeTimers = [];
  }

  async connect(opts: {
    wsUrl: string;
    roomId: string;
    identity: string;
    name: string;
    micDeviceId?: string;
    outputDeviceId?: string;
  }): Promise<void> {
    await this.disconnect();
    installRtcDiagnostics();

    const envLine = [
      `href=${typeof location !== "undefined" ? location.href : "?"}`,
      `secure=${typeof window !== "undefined" ? String(window.isSecureContext) : "?"}`,
      `ws=${opts.wsUrl}`,
      `room=${opts.roomId}`,
      `identity=${opts.identity}`,
      `micDevice=${opts.micDeviceId || "default"}`,
      `RTCPeerConnection=${typeof RTCPeerConnection !== "undefined"}`,
      `mediaDevices=${!!navigator.mediaDevices?.getUserMedia}`,
    ].join(" ");
    await voiceLog("webrtc", `connect begin ${envLine}`);

    // WKWebView/Safari silently block WebRTC PC setup until getUserMedia has
    // been granted — request the mic before room.connect().
    let track: LocalAudioTrack;
    try {
      track = await createLocalAudioTrack({
        deviceId: opts.micDeviceId,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      await voiceLog(
        "webrtc",
        `mic ok track=${track.mediaStreamTrack?.label || "?"} ready=${track.mediaStreamTrack?.readyState || "?"}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await voiceLog("webrtc", `mic FAILED: ${msg}`);
      throw new Error(
        msg.includes("Permission") || msg.includes("NotAllowed")
          ? "Microphone permission denied — allow mic for Remined, then retry"
          : `Microphone unavailable: ${msg}`,
      );
    }

    const token = await voiceMintToken(opts.roomId, opts.identity, opts.name);
    await voiceLog("webrtc", `token ok len=${token.length}`);
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      // Keep the session when the WebView fires pagehide (tab/rail switches).
      disconnectOnPageLeave: false,
      // WKWebView: HTMLAudioElement attach/detach of remote tracks crashes
      // WebContent (RealtimeIncomingAudioSourceCocoa PAC). Mix via WebAudio.
      webAudioMix: true,
      audioCaptureDefaults: {
        deviceId: opts.micDeviceId,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.outputDeviceId = opts.outputDeviceId;
    room.on(RoomEvent.ParticipantConnected, (p) => {
      this.cbs.onRemoteJoined?.(p.identity);
      this.cbs.onParticipants?.();
    });
    room.on(RoomEvent.ParticipantDisconnected, (p) => {
      this.cbs.onSpeaking?.(p.identity, false);
      this.cbs.onParticipants?.();
      // Drop frozen last-frame tiles immediately — pubs can linger briefly.
      this.cbs.onVideo?.();
      this.cbs.onRemoteLeft?.(p.identity);
      // Second pass after LiveKit finishes unpublish/detach.
      queueMicrotask(() => this.cbs.onVideo?.());
      setTimeout(() => this.cbs.onVideo?.(), 120);
    });
    room.on(RoomEvent.TrackMuted, (pub) => {
      this.cbs.onParticipants?.();
      if (pub.kind === Track.Kind.Video) this.cbs.onVideo?.();
    });
    room.on(RoomEvent.TrackUnmuted, (pub) => {
      this.cbs.onParticipants?.();
      if (pub.kind === Track.Kind.Video) this.cbs.onVideo?.();
    });
    room.on(RoomEvent.ParticipantAttributesChanged, () => this.cbs.onParticipants?.());
    room.on(RoomEvent.LocalTrackPublished, () => {
      this.cbs.onVideo?.();
      this.scheduleResume();
    });
    room.on(RoomEvent.LocalTrackUnpublished, () => {
      this.cbs.onVideo?.();
      this.scheduleResume();
    });
    room.on(RoomEvent.TrackUnpublished, (pub) => {
      if (pub.kind === Track.Kind.Video) this.cbs.onVideo?.();
    });
    room.on(RoomEvent.TrackPublished, (pub) => {
      this.cbs.onParticipants?.();
      if (pub.kind === Track.Kind.Video) this.cbs.onVideo?.();
    });
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      this.cbs.onAudioPlayback?.(room.canPlaybackAudio);
      if (!room.canPlaybackAudio) this.scheduleResume();
    });
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const ids = new Set(speakers.map((s) => s.identity));
      for (const p of room.remoteParticipants.values()) {
        this.cbs.onSpeaking?.(p.identity, ids.has(p.identity));
      }
      if (room.localParticipant) {
        this.cbs.onSpeaking?.(
          room.localParticipant.identity,
          ids.has(room.localParticipant.identity),
        );
      }
    });
    room.on(RoomEvent.Disconnected, (reason) => {
      void voiceLog("webrtc", `disconnected reason=${String(reason ?? "")}`);
      this.cbs.onDisconnected?.();
    });
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      void voiceLog("webrtc", `connectionState=${state}`);
    });
    room.on(
      RoomEvent.TrackSubscribed,
      (trackRemote, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (trackRemote.kind === Track.Kind.Video) {
          // Remote MST often starts muted until the first frame — refresh then too.
          this.watchRemoteVideoMedia(trackRemote.mediaStreamTrack);
          this.cbs.onVideo?.();
          voidMicrotask(() => this.cbs.onVideo?.());
          setTimeout(() => this.cbs.onVideo?.(), 80);
          setTimeout(() => this.cbs.onVideo?.(), 400);
          return;
        }
        if (trackRemote.kind !== Track.Kind.Audio) return;
        this.ensureRemoteAudioAttached(participant);
        // Mute badges read pubs here — refresh or "no pubs yet" sticks as muted.
        this.cbs.onParticipants?.();
        this.scheduleResume();
      },
    );
    room.on(RoomEvent.TrackUnsubscribed, (trackRemote) => {
      // Detach only when the track is actually gone (safe). Never detach on resume.
      try {
        const detached = trackRemote.detach();
        const els = Array.isArray(detached) ? detached : [detached];
        if (trackRemote.kind === Track.Kind.Video) {
          for (const el of els) {
            if (el instanceof HTMLVideoElement) {
              el.pause();
              el.removeAttribute("src");
              el.srcObject = null;
              el.load();
            }
          }
          this.cbs.onVideo?.();
          return;
        }
        for (const el of els) el.remove();
        if (trackRemote.kind === Track.Kind.Audio) this.cbs.onParticipants?.();
      } catch {
        if (trackRemote.kind === Track.Kind.Video) this.cbs.onVideo?.();
        else this.cbs.onParticipants?.();
      }
    });

    try {
      // Empty iceServers: localhost SFU — public STUN just delays / breaks ICE in WKWebView.
      await room.connect(opts.wsUrl, token, {
        autoSubscribe: true,
        peerConnectionTimeout: 25_000,
        // Porthole guests need extra headroom for the first WS after bind.
        websocketTimeout: 20_000,
        maxRetries: 3,
        rtcConfig: {
          iceServers: [],
          iceTransportPolicy: "all",
        },
      });
      await voiceLog(
        "webrtc",
        `room.connect ok state=${room.state} participants=${room.remoteParticipants.size}`,
      );
    } catch (err) {
      track.stop();
      const msg = err instanceof Error ? err.message : String(err);
      const detail =
        err instanceof ConnectionError
          ? `ConnectionError reason=${err.reasonName || err.reason} status=${String(err.status ?? "")} msg=${msg}`
          : `error name=${err instanceof Error ? err.name : typeof err} msg=${msg}`;
      await voiceLog("webrtc", `room.connect FAILED ${detail}`);
      // Modal shows voice.log path separately — keep thrown messages short.
      try {
        await voiceLog("webrtc", `logPath=${await voiceLogPath()}`);
      } catch {
        /* ignore */
      }
      if (/could not establish pc connection/i.test(msg)) {
        throw new Error(
          "Voice WebRTC failed (no ICE to local LiveKit). Retry once; if it persists with a VPN/TUN, exclude 127.0.0.1 or bypass Remined.",
        );
      }
      if (/not valid yet|invalid claims|invalid authorization token/i.test(msg)) {
        throw new Error(
          "Voice token rejected (clock skew between PCs). Sync date/time on both machines, then retry.",
        );
      }
      if (/timeout|timed out/i.test(msg)) {
        throw new Error(
          "Voice connection timeout. VPN or firewall may be blocking localhost.",
        );
      }
      throw new Error(msg);
    }
    this.room = room;
    this.localTrack = track;
    try {
      await room.localParticipant.publishTrack(track);
      await voiceLog("webrtc", "publishTrack ok");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await voiceLog("webrtc", `publishTrack FAILED: ${msg}`);
      throw err instanceof Error ? err : new Error(msg);
    }
    if (this.outputDeviceId) {
      await this.switchOutput(this.outputDeviceId);
    }
    this.wireResumeHooks();
    this.scheduleResume();
    this.cbs.onParticipants?.();
  }

  /** 0..1 instantaneous mic level for UI meter (disabled on WKWebView). */
  getMicLevel(): number {
    return 0;
  }

  async setMuted(muted: boolean) {
    this.muted = muted;
    if (this.localTrack) {
      if (muted) await this.localTrack.mute();
      else await this.localTrack.unmute();
    }
  }

  isMuted() {
    return this.muted;
  }

  setDeafened(deafened: boolean) {
    this.deafened = deafened;
    this.applyAllVolumes();
    // Sync to the room so others see the deafen icon.
    void this.room?.localParticipant
      .setAttributes({ deafened: deafened ? "1" : "0" })
      .catch(() => undefined);
    this.cbs.onParticipants?.();
  }

  /** 0..1 playback volume for one remote participant. */
  setParticipantVolume(identity: string, volume: number) {
    const v = Math.max(0, Math.min(1, volume));
    this.volumes.set(identity, v);
    this.applyRemoteVolume(identity);
  }

  getParticipantVolume(identity: string): number {
    return this.volumes.get(identity) ?? 1;
  }

  /** Mic-muted / deafened flags for the member grid (works for self + remote). */
  getParticipantState(identity: string): VoiceParticipantState {
    const room = this.room;
    if (!room) return { muted: false, deafened: false };
    if (room.localParticipant.identity === identity) {
      return { muted: this.muted, deafened: this.deafened };
    }
    const p = room.remoteParticipants.get(identity);
    if (!p) return { muted: false, deafened: false };
    const pubs = [...p.audioTrackPublications.values()];
    // No audio pub yet ≠ muted (join race). Only show mute when a live pub is muted.
    const muted =
      pubs.length > 0 &&
      pubs.every((x) => x.isMuted || x.track?.isMuted === true);
    return {
      muted,
      deafened: p.attributes?.deafened === "1",
    };
  }

  /** When MST unmutes (first frame), refresh tiles so the remote cam appears. */
  private watchRemoteVideoMedia(media: MediaStreamTrack | undefined) {
    if (!media) return;
    const bump = () => this.cbs.onVideo?.();
    if (!media.muted) {
      bump();
      return;
    }
    const onUnmute = () => {
      media.removeEventListener("unmute", onUnmute);
      bump();
    };
    media.addEventListener("unmute", onUnmute);
  }

  async setCameraEnabled(on: boolean) {
    if (!this.room) return;
    await this.room.localParticipant.setCameraEnabled(on);
    this.cbs.onVideo?.();
    this.scheduleResume();
  }

  async setScreenShareEnabled(on: boolean) {
    if (!this.room) return;
    await this.room.localParticipant.setScreenShareEnabled(on, {
      audio: false,
    });
    this.cbs.onVideo?.();
    this.scheduleResume();
  }

  isCameraOn(): boolean {
    return this.room?.localParticipant.isCameraEnabled ?? false;
  }

  isScreenSharing(): boolean {
    return this.room?.localParticipant.isScreenShareEnabled ?? false;
  }

  videoTiles(): VoiceVideoTile[] {
    const room = this.room;
    if (!room) return [];
    const out: VoiceVideoTile[] = [];
    const add = (
      identity: string,
      local: boolean,
      pubs: Iterable<{
        track?: Track | null;
        source: Track.Source;
        isMuted?: boolean;
        isSubscribed?: boolean;
      }>,
    ) => {
      for (const pub of pubs) {
        const track = pub.track;
        if (!track || track.kind !== Track.Kind.Video) continue;
        // LiveKit mute only — do NOT filter MediaStreamTrack.muted: remotes often
        // start muted until the first decoded frame, which hid the tile until a
        // local cam publish forced another refresh.
        if (pub.isMuted || track.isMuted) continue;
        // Remote pubs may linger after unpublish until detach — require a live MST.
        if (pub.isSubscribed === false) continue;
        const media = track.mediaStreamTrack;
        if (!media || media.readyState !== "live") continue;
        out.push({
          identity,
          local,
          track,
          source: pub.source === Track.Source.ScreenShare ? "screen" : "camera",
        });
      }
    };
    add(
      room.localParticipant.identity,
      true,
      room.localParticipant.videoTrackPublications.values(),
    );
    for (const p of room.remoteParticipants.values()) {
      add(p.identity, false, p.videoTrackPublications.values());
    }
    return out;
  }

  isDeafened() {
    return this.deafened;
  }

  participantIds(): string[] {
    if (!this.room) return [];
    const ids = [this.room.localParticipant.identity];
    for (const p of this.room.remoteParticipants.values()) {
      ids.push(p.identity);
    }
    return ids;
  }

  async switchMic(deviceId: string) {
    if (!this.room || !this.localTrack) return;
    await this.localTrack.restartTrack({ deviceId });
  }

  async switchOutput(deviceId: string) {
    this.outputDeviceId = deviceId || undefined;
    const room = this.room;
    if (!room) return;
    // Empty id = system default. Prefer per-element setSinkId; WKWebView often
    // lacks AudioContext.setSinkId, and switchActiveDevice can mute playback.
    const sink = deviceId || "default";
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) {
        const track = pub.track;
        if (!track || track.kind !== Track.Kind.Audio) continue;
        if ("setSinkId" in track && typeof track.setSinkId === "function") {
          void track.setSinkId(sink).catch(() => undefined);
        }
      }
    }
    document
      .querySelectorAll<HTMLAudioElement>("audio[data-identity]")
      .forEach((el) => {
        if ("setSinkId" in el) {
          void (
            el as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }
          )
            .setSinkId(sink)
            .catch(() => undefined);
        }
        void el.play().catch(() => undefined);
      });
    void this.resumePlayback();
  }

  async disconnect() {
    this.unwireResumeHooks();
    try {
      const lp = this.room?.localParticipant;
      // Unpublish cam/screen before disconnect so hosts drop tiles instead of
      // freezing on the last frame.
      if (lp) {
        await Promise.allSettled([
          lp.setCameraEnabled(false),
          lp.setScreenShareEnabled(false),
        ]);
      }
      this.localTrack?.stop();
      this.localTrack = null;
      await this.room?.disconnect();
    } catch {
      /* ignore */
    }
    this.room = null;
    this.cbs.onVideo?.();
    document
      .querySelectorAll("audio[data-identity]")
      .forEach((el) => el.remove());
  }
}
