import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

export type VoiceHostReady = {
  share_code: string;
  ws_url: string;
  tcp_port: number;
  udp_start: number;
  udp_end: number;
};

export async function voiceLogPath(): Promise<string> {
  return invoke<string>("voice_log_path");
}

export async function voiceLog(
  source: string,
  message: string,
): Promise<void> {
  try {
    await invoke("voice_log_append", { source, message });
  } catch {
    /* logging must never break voice */
  }
}

export async function voiceLogTail(maxBytes = 48_000): Promise<string> {
  return invoke<string>("voice_log_tail", { maxBytes });
}

/** Reveal `voice.log` in Finder / Explorer. */
export async function voiceRevealLog(): Promise<string> {
  const path = await voiceLogPath();
  await revealItemInDir(path);
  return path;
}

export async function voiceEnsureRuntime(): Promise<string> {
  return invoke<string>("voice_ensure_runtime");
}

/** Local LiveKit SFU only — call before host WebRTC connect. */
export async function voiceStartLivekit(): Promise<VoiceHostReady> {
  return invoke<VoiceHostReady>("voice_start_livekit");
}

/** Steam Porthole expose — call after host has joined LiveKit locally. */
export async function voiceStartPorthole(): Promise<VoiceHostReady> {
  return invoke<VoiceHostReady>("voice_start_porthole");
}

export async function voiceStartHost(): Promise<VoiceHostReady> {
  return invoke<VoiceHostReady>("voice_start_host");
}

export async function voiceStopHost(): Promise<void> {
  await invoke("voice_stop_host");
}

export async function voiceGuestConnect(shareCode: string): Promise<void> {
  await invoke("voice_guest_connect", { shareCode });
}

export async function voiceMintToken(
  room: string,
  identity: string,
  name: string,
): Promise<string> {
  return invoke<string>("voice_mint_token", { room, identity, name });
}
