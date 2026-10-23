import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "@/shared/api/invoke";
import { CMD } from "@/shared/config/commands";
import { EVENT } from "@/shared/config/events";

/** Messages the launcher sends to the in-game companion mod (`t` = message type). */
export type GameBridgeMessage = { t: string; [key: string]: unknown };

/** Messages the mod sends back (`{"t":"key",...}`, `{"t":"connect_result",...}`). */
export type GameBridgeEvent = {
  t: string;
  action?: string;
  id?: string;
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

/** Send one message to the mod. Resolves `false` when the bridge is not connected. */
export async function sendGameBridge(msg: GameBridgeMessage): Promise<boolean> {
  try {
    return await call<boolean>(CMD.gameBridgeSend, { msg });
  } catch {
    return false;
  }
}

export function gameBridgeStatus(): Promise<boolean> {
  return call<boolean>(CMD.gameBridgeStatus);
}

export function onGameBridgeEvent(cb: (ev: GameBridgeEvent) => void): Promise<UnlistenFn> {
  return listen<GameBridgeEvent>(EVENT.gameBridge, (e) => cb(e.payload));
}

export function onGameBridgeStatus(cb: (connected: boolean) => void): Promise<UnlistenFn> {
  return listen<{ connected: boolean }>(EVENT.gameBridgeStatus, (e) =>
    cb(Boolean(e.payload?.connected)),
  );
}

export type GameNotifyKind = "friend" | "request" | "chat" | "invite" | "info";

/** In-game notification (rendered by the mod). `head` = userId whose face was sent with `head`. */
export type GameNotify = {
  kind: GameNotifyKind;
  title: string;
  body?: string;
  head?: string;
  action?: { type: "join"; id: string; ttl: number };
};

export function sendGameNotify(note: GameNotify): void {
  void sendGameBridge({ t: "notify", ...note });
}
