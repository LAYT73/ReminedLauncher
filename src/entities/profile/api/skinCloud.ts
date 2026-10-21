import { call } from "@/shared/api/invoke";
import {
  capePublicUrl,
  skinPublicUrl,
  updateCloudCapeUrl,
  updateCloudSkinUrl,
} from "./cloudProfile";
import { supabase } from "@/shared/api/supabase";
import { CMD } from "@/shared/config/commands";
import { BUCKET } from "@/shared/config/supabase";

/** Hard caps — Storage bucket also enforces 256 KB + image/png. */
const MAX_BYTES = 256 * 1024;
const ALLOWED_SKIN_SIZES: Array<[number, number]> = [
  [64, 32],
  [64, 64],
  [128, 128],
];
/** Vanilla cape is 64×32; allow a few common variants. */
const ALLOWED_CAPE_SIZES: Array<[number, number]> = [
  [64, 32],
  [64, 64],
  [22, 17],
];

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(",")[1];
  if (!b64) throw new Error("Invalid skin data");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function assertPngMagic(bytes: Uint8Array) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24) throw new Error("File too small to be a skin");
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) throw new Error("Skin must be a PNG file");
  }
}

function readPngSize(bytes: Uint8Array): { w: number; h: number } {
  // IHDR width/height at bytes 16..23 (big-endian)
  const w =
    ((bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!) >>>
    0;
  const h =
    ((bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!) >>>
    0;
  return { w, h };
}

/** Reject anything that isn’t a normal Minecraft skin PNG. */
export function validateSkinPng(dataUrl: string): Uint8Array {
  if (!dataUrl.startsWith("data:image/png")) {
    throw new Error("Only PNG skins are allowed");
  }
  const bytes = dataUrlToBytes(dataUrl);
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error(`Skin is too large (max ${MAX_BYTES / 1024} KB)`);
  }
  assertPngMagic(bytes);
  const { w, h } = readPngSize(bytes);
  const ok = ALLOWED_SKIN_SIZES.some(([aw, ah]) => aw === w && ah === h);
  if (!ok) {
    throw new Error("Skin must be 64×64, 64×32, or 128×128 PNG");
  }
  return bytes;
}

/** Reject anything that isn’t a normal Minecraft cape PNG. */
export function validateCapePng(dataUrl: string): Uint8Array {
  if (!dataUrl.startsWith("data:image/png")) {
    throw new Error("Only PNG capes are allowed");
  }
  const bytes = dataUrlToBytes(dataUrl);
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error(`Cape is too large (max ${MAX_BYTES / 1024} KB)`);
  }
  assertPngMagic(bytes);
  const { w, h } = readPngSize(bytes);
  const ok = ALLOWED_CAPE_SIZES.some(([aw, ah]) => aw === w && ah === h);
  if (!ok) {
    throw new Error("Cape must be 64×32 PNG (64×64 / 22×17 also ok)");
  }
  return bytes;
}

/** Upsert one skin per Remined id in Supabase Storage (`skins/{id}.png`). */
export async function publishAccountSkin(
  reminedId: string,
  localPath: string,
  userId: string,
): Promise<string> {
  if (!/^[a-z0-9]{7}$/i.test(reminedId)) {
    throw new Error("Invalid Remined id");
  }

  const dataUrl = await call<string | null>(CMD.readSkinDataUrl, {
    path: localPath,
  });
  if (!dataUrl) throw new Error("Could not read skin");

  const bytes = validateSkinPng(dataUrl);
  const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
  const objectPath = `${reminedId.toLowerCase()}.png`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET.skins)
    .upload(objectPath, blob, { upsert: true, contentType: "image/png" });
  if (upErr) throw upErr;

  const url = skinPublicUrl(reminedId.toLowerCase(), true).split("?")[0]!;
  await updateCloudSkinUrl(userId, url);
  return url;
}

export async function clearAccountSkin(
  reminedId: string,
  userId: string,
): Promise<void> {
  const objectPath = `${reminedId.toLowerCase()}.png`;
  await supabase.storage.from(BUCKET.skins).remove([objectPath]);
  await updateCloudSkinUrl(userId, null);
}

/** Upsert cape PNG at `skins/{id}_cape.png`. */
export async function publishAccountCape(
  reminedId: string,
  localPath: string,
  userId: string,
): Promise<string> {
  if (!/^[a-z0-9]{7}$/i.test(reminedId)) {
    throw new Error("Invalid Remined id");
  }

  const dataUrl = await call<string | null>(CMD.readSkinDataUrl, {
    path: localPath,
  });
  if (!dataUrl) throw new Error("Could not read cape");

  const bytes = validateCapePng(dataUrl);
  const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
  const objectPath = `${reminedId.toLowerCase()}_cape.png`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET.skins)
    .upload(objectPath, blob, { upsert: true, contentType: "image/png" });
  if (upErr) throw upErr;

  const url = capePublicUrl(reminedId.toLowerCase(), true).split("?")[0]!;
  await updateCloudCapeUrl(userId, url);
  return url;
}

export async function clearAccountCape(
  reminedId: string,
  userId: string,
): Promise<void> {
  const objectPath = `${reminedId.toLowerCase()}_cape.png`;
  await supabase.storage.from(BUCKET.skins).remove([objectPath]);
  await updateCloudCapeUrl(userId, null);
}
