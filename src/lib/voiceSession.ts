import {
  ConnectionError,
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type LocalAudioTrack,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from "livekit-client";
import { voiceLog, voiceLogPath, voiceMintToken } from "./voiceNative";

export type VoiceDeviceLists = {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
};

export type VoiceSessionCallbacks = {
  onParticipants?: () => void;
  onSpeaking?: (identity: string, speaking: boolean) => void;
  onDisconnected?: () => void;
  onError?: (message: string) => void;
};

export class VoiceSession {
  room: Room | null = null;
  localTrack: LocalAudioTrack | null = null;
  private muted = false;
  private deafened = false;
  private levelCtx: AudioContext | null = null;
  private levelAnalyser: AnalyserNode | null = null;
  private levelSource: MediaStreamAudioSourceNode | null = null;
  private cbs: VoiceSessionCallbacks;

  constructor(cbs: VoiceSessionCallbacks = {}) {
    this.cbs = cbs;
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
      audioCaptureDefaults: {
        deviceId: opts.micDeviceId,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    room.on(RoomEvent.ParticipantConnected, () => this.cbs.onParticipants?.());
    room.on(RoomEvent.ParticipantDisconnected, () => this.cbs.onParticipants?.());
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
        if (trackRemote.kind !== Track.Kind.Audio) return;
        const el = trackRemote.attach();
        el.dataset.identity = participant.identity;
        el.autoplay = true;
        el.style.display = "none";
        document.body.appendChild(el);
        if (opts.outputDeviceId && "setSinkId" in el) {
          void (el as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> })
            .setSinkId(opts.outputDeviceId)
            .catch(() => undefined);
        }
        if (this.deafened) el.muted = true;
      },
    );
    room.on(RoomEvent.TrackUnsubscribed, (trackRemote) => {
      trackRemote.detach().forEach((el) => el.remove());
    });

    try {
      // Empty iceServers: localhost SFU — public STUN just delays / breaks ICE in WKWebView.
      await room.connect(opts.wsUrl, token, {
        autoSubscribe: true,
        peerConnectionTimeout: 25_000,
        maxRetries: 2,
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
      let logHint = "";
      try {
        logHint = ` Log: ${await voiceLogPath()}`;
      } catch {
        /* ignore */
      }
      if (/could not establish pc connection/i.test(msg)) {
        throw new Error(
          `Voice WebRTC failed. If you're using a VPN, try disabling it or adding 127.0.0.1 to VPN bypass list.${logHint}`,
        );
      }
      if (/timeout|timed out/i.test(msg)) {
        throw new Error(
          `Voice connection timeout. VPN or firewall may be blocking localhost connections.${logHint}`,
        );
      }
      throw new Error(`${msg}${logHint}`);
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

export async function listAudioDevices(): Promise<VoiceDeviceLists> {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    /* permission may already exist */
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    inputs: all.filter((d) => d.kind === "audioinput"),
    outputs: all.filter((d) => d.kind === "audiooutput"),
  };
}
