import { call } from "@/shared/api/invoke";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CMD } from "@/shared/config/commands";

export type VoiceHostReady = {
  share_code: string;
  ws_url: string;
  tcp_port: number;
  udp_start: number;
  udp_end: number;
};

export async function voiceLogPath(): Promise<string> {
  return call<string>(CMD.voiceLogPath);
}

export async function voiceLog(
  source: string,
  message: string,
): Promise<void> {
  try {
    await call(CMD.voiceLogAppend, { source, message });
  } catch {
    /* logging must never break voice */
  }
}

export async function voiceLogTail(maxBytes = 48_000): Promise<string> {
  return call<string>(CMD.voiceLogTail, { maxBytes });
}

/** Reveal `voice.log` in Finder / Explorer. */
export async function voiceRevealLog(): Promise<string> {
  const path = await voiceLogPath();
  await revealItemInDir(path);
  return path;
}

export async function voiceEnsureRuntime(): Promise<string> {
  return call<string>(CMD.voiceEnsureRuntime);
}

/** Local LiveKit SFU only — call before host WebRTC connect. */
export async function voiceStartLivekit(): Promise<VoiceHostReady> {
  return call<VoiceHostReady>(CMD.voiceStartLivekit);
}

/** Relay tunnel for voice — call after host has joined LiveKit locally.
 *  Pass `lanPort` in Relay-only mode to pre-reserve Open-to-LAN. */
export async function voiceStartRelay(
  lanPort?: number | null,
): Promise<VoiceHostReady> {
  return call<VoiceHostReady>(CMD.voiceStartRelay, {
    lanPort: lanPort && lanPort > 0 ? lanPort : null,
  });
}

export async function voiceStartHost(): Promise<VoiceHostReady> {
  return call<VoiceHostReady>(CMD.voiceStartHost);
}

/** Stop LiveKit while optionally keeping the shared Relay host for LAN. */
export async function voiceStopHost(
  keepLanPort?: number | null,
  keepRelay = false,
): Promise<void> {
  await call(CMD.voiceStopHost, {
    keepLanPort: keepLanPort && keepLanPort > 0 ? keepLanPort : null,
    keepRelay,
  });
}

export async function voiceGuestConnect(shareCode: string): Promise<void> {
  await call(CMD.voiceGuestConnect, { shareCode });
}

export async function voiceGuestDisconnect(): Promise<void> {
  await call(CMD.voiceGuestDisconnect);
}

export async function voiceMintToken(
  room: string,
  identity: string,
  name: string,
): Promise<string> {
  return call<string>(CMD.voiceMintToken, { room, identity, name });
}
