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
  private levelCtx: AudioContext | null = null;
  private levelAnalyser: AnalyserNode | null = null;
  private levelSource: MediaStreamAudioSourceNode | null = null;
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

  /** Force-reattach remote audio after cam/share/focus steals the WebView path. */
  async resumePlayback() {
    const room = this.room;
    if (!room) return;
    try {
      await room.startAudio();
    } catch {
      /* autoplay policies vary */
    }
    try {
      if (this.levelCtx && this.levelCtx.state === "suspended") {
        await this.levelCtx.resume();
      }
    } catch {
      /* meter optional */
    }

    // Drop stale <audio> nodes — WebView leaves them paused after renegotiation.
    document.querySelectorAll("audio[data-identity]").forEach((el) => el.remove());

    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) {
        const track = pub.track;
        if (!track || track.kind !== Track.Kind.Audio) continue;
        try {
          const detached = track.detach();
          const old = Array.isArray(detached) ? detached : [detached];
          for (const el of old) el.remove();
        } catch {
          /* ignore */
        }
        const attached = track.attach();
        const els = Array.isArray(attached) ? attached : [attached];
        for (const el of els) {
          if (!(el instanceof HTMLAudioElement)) continue;
          el.dataset.identity = p.identity;
          el.autoplay = true;
          el.style.display = "none";
          el.muted = this.deafened;
          el.volume = this.volumes.get(p.identity) ?? 1;
          document.body.appendChild(el);
          if (this.outputDeviceId && "setSinkId" in el) {
            void (
              el as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }
            )
              .setSinkId(this.outputDeviceId)
              .catch(() => undefined);
          }
          void el.play().catch(() => undefined);
        }
      }
    }
    this.cbs.onAudioPlayback?.(room.canPlaybackAudio);
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
      let remoteAudio = 0;
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.audioTrackPublications.values()) {
          if (pub.track?.kind === Track.Kind.Audio) remoteAudio += 1;
        }
      }
      if (remoteAudio === 0) return;
      const nodes = document.querySelectorAll<HTMLAudioElement>("audio[data-identity]");
      const dead =
        nodes.length < remoteAudio ||
        [...nodes].some((el) => el.paused || el.ended || el.readyState === 0);
      if (dead || !room.canPlaybackAudio) void this.resumePlayback();
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
      webAudioMix: false,
      audioCaptureDefaults: {
        deviceId: opts.micDeviceId,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.outputDeviceId = opts.outputDeviceId;
    room.on(RoomEvent.ParticipantConnected, () => this.cbs.onParticipants?.());
    room.on(RoomEvent.ParticipantDisconnected, (p) => {
      this.cbs.onSpeaking?.(p.identity, false);
      this.cbs.onParticipants?.();
      this.cbs.onVideo?.();
    });
    room.on(RoomEvent.TrackMuted, () => this.cbs.onParticipants?.());
    room.on(RoomEvent.TrackUnmuted, () => this.cbs.onParticipants?.());
    room.on(RoomEvent.ParticipantAttributesChanged, () => this.cbs.onParticipants?.());
    room.on(RoomEvent.LocalTrackPublished, () => {
      this.cbs.onVideo?.();
      this.scheduleResume();
    });
    room.on(RoomEvent.LocalTrackUnpublished, () => {
      this.cbs.onVideo?.();
      this.scheduleResume();
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
          this.cbs.onVideo?.();
          return;
        }
        if (trackRemote.kind !== Track.Kind.Audio) return;
        const el = trackRemote.attach();
        el.dataset.identity = participant.identity;
        el.autoplay = true;
        el.style.display = "none";
        el.volume = this.volumes.get(participant.identity) ?? 1;
        document.body.appendChild(el);
        if (this.outputDeviceId && "setSinkId" in el) {
          void (el as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> })
            .setSinkId(this.outputDeviceId)
            .catch(() => undefined);
        }
        if (this.deafened) el.muted = true;
        void el.play().catch(() => undefined);
        this.scheduleResume();
      },
    );
    room.on(RoomEvent.TrackUnsubscribed, (trackRemote) => {
      const detached = trackRemote.detach();
      const els = Array.isArray(detached) ? detached : [detached];
      if (trackRemote.kind === Track.Kind.Video) {
        for (const el of els) {
          if (el instanceof HTMLVideoElement) el.srcObject = null;
        }
        this.cbs.onVideo?.();
        return;
      }
      for (const el of els) el.remove();
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
    this.wireLevelMeter(track);
    this.wireResumeHooks();
    this.scheduleResume();
    this.cbs.onParticipants?.();
  }

  private wireLevelMeter(track: LocalAudioTrack) {
    this.teardownLevelMeter();
    try {
      const stream = new MediaStream([track.mediaStreamTrack]);
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      this.levelCtx = ctx;
      this.levelSource = source;
      this.levelAnalyser = analyser;
    } catch {
      /* mic meter optional */
    }
  }

  /** 0..1 instantaneous mic level for UI meter */
  getMicLevel(): number {
    const analyser = this.levelAnalyser;
    if (!analyser) return 0;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i]! - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    return Math.min(1, rms * 3.2);
  }

  private teardownLevelMeter() {
    try {
      this.levelSource?.disconnect();
      this.levelAnalyser?.disconnect();
      void this.levelCtx?.close();
    } catch {
      /* ignore */
    }
    this.levelSource = null;
    this.levelAnalyser = null;
    this.levelCtx = null;
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
    document
      .querySelectorAll<HTMLAudioElement>("audio[data-identity]")
      .forEach((el) => {
        el.muted = deafened;
      });
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
    document
      .querySelectorAll<HTMLAudioElement>("audio[data-identity]")
      .forEach((el) => {
        if (el.dataset.identity === identity) el.volume = v;
      });
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
    return {
      muted: pubs.length === 0 || pubs.every((x) => x.isMuted),
      deafened: p.attributes?.deafened === "1",
    };
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
      pubs: Iterable<{ track?: Track; source: Track.Source; isMuted?: boolean }>,
    ) => {
      for (const pub of pubs) {
        const track = pub.track;
        if (!track || track.kind !== Track.Kind.Video) continue;
        if (pub.isMuted) continue;
        const media = track.mediaStreamTrack;
        if (!media || media.readyState === "ended") continue;
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
    this.wireLevelMeter(this.localTrack);
  }

  async switchOutput(deviceId: string) {
    this.outputDeviceId = deviceId;
    document
      .querySelectorAll<HTMLAudioElement>("audio[data-identity]")
      .forEach((el) => {
        if ("setSinkId" in el) {
          void (el as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> })
            .setSinkId(deviceId)
            .catch(() => undefined);
        }
      });
  }

  async disconnect() {
    this.unwireResumeHooks();
    this.teardownLevelMeter();
    try {
      this.localTrack?.stop();
      this.localTrack = null;
      await this.room?.disconnect();
    } catch {
      /* ignore */
    }
    this.room = null;
    document
      .querySelectorAll("audio[data-identity]")
      .forEach((el) => el.remove());
  }
}
