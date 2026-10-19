const VANILLA_PREFIX = "vanilla-";
const REMINED_VANILLA_PREFIX = "remined-vanilla-";

export function isVanillaPackId(packId: string | null | undefined): boolean {
  return Boolean(packId?.startsWith(VANILLA_PREFIX));
}

export function isReminedVanillaPackId(
  packId: string | null | undefined,
): boolean {
  return Boolean(packId?.startsWith(REMINED_VANILLA_PREFIX));
}

/** Remined catalog pack (neither vanilla edition). */
export function isReminePackId(packId: string | null | undefined): boolean {
  return !isVanillaPackId(packId) && !isReminedVanillaPackId(packId);
}

/** Pack id for a vanilla / Remined Vanilla version pick ("" when nothing picked). */
export function vanillaPackId(version: string): string {
  return version ? `${VANILLA_PREFIX}${version}` : "";
}

export function reminedVanillaPackId(version: string): string {
  return version ? `${REMINED_VANILLA_PREFIX}${version}` : "";
}

/** Minecraft version embedded in a vanilla / Remined Vanilla pack id. */
export function versionFromPackId(packId: string): string {
  return packId.replace(REMINED_VANILLA_PREFIX, "").replace(VANILLA_PREFIX, "");
}
