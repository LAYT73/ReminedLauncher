import { sendGameBridge, sendGameNotify, type GameNotify } from "@/shared/api/gameBridge";
import { useGameBridgeStore } from "@/shared/lib/gameBridgeStore";
import steveUrl from "@/shared/assets/steve.png";

/**
 * 8×8 face (base layer + hat overlay) as base64 RGBA for the in-game mod.
 * Coordinates match SkinHead: face at (8,8), hat at (40,8), 8×8 each.
 */

/** Skin source → encoded face (shared across callers). */
const faceCache = new Map<string, Promise<string>>();
/** userId → skin source last sent on this bridge connection. */
const sentHeads = new Map<string, { src: string; done: Promise<void> }>();

// A new bridge connection starts with no heads on the mod side.
useGameBridgeStore.subscribe((s, prev) => {
  if (s.connected !== prev.connected) sentHeads.clear();
});

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:\/\//i.test(src)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("skin load failed"));
    img.src = src;
  });
}

function encodeFace(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
  if (img.width >= 64 && img.height >= 32) {
    ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
  }
  const data = ctx.getImageData(0, 0, 8, 8).data;
  let bin = "";
  for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
  return btoa(bin);
}

function faceFor(src: string): Promise<string> {
  let p = faceCache.get(src);
  if (!p) {
    // Any failure (missing / tainted skin) falls back to the bundled steve.
    p = loadImage(src)
      .then(encodeFace)
      .catch(() => loadImage(steveUrl).then(encodeFace));
    p.catch(() => faceCache.delete(src));
    faceCache.set(src, p);
  }
  return p;
}

/**
 * Send a member's face once per bridge connection (again when the skin changes).
 * Resolves when the head is on its way, so a snapshot or notify sent after can rely on it.
 */
export function sendGameHead(userId: string, skinUrl: string | null | undefined): Promise<void> {
  if (!useGameBridgeStore.getState().connected) return Promise.resolve();
  const src = skinUrl?.trim() || steveUrl;
  const prev = sentHeads.get(userId);
  if (prev && prev.src === src) return prev.done;
  const entry: { src: string; done: Promise<void> } = {
    src,
    done: Promise.resolve(),
  };
  entry.done = faceFor(src)
    .then((rgba) => sendGameBridge({ t: "head", id: userId, rgba }))
    .then(
      () => undefined,
      () => {
        if (sentHeads.get(userId) === entry) sentHeads.delete(userId);
      },
    );
  sentHeads.set(userId, entry);
  return entry.done;
}

/** Notify the mod; when `head` is given, its face is sent first and referenced by userId. */
export function sendGameNotifyWithHead(
  note: Omit<GameNotify, "head">,
  head?: { userId: string; skinUrl: string | null | undefined },
): void {
  if (!head) {
    sendGameNotify(note);
    return;
  }
  void sendGameHead(head.userId, head.skinUrl).then(() =>
    sendGameNotify({ ...note, head: head.userId }),
  );
}
