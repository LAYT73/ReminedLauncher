/** Minecraft player model — matches SkinShuffle / CustomSkinLoader / Mojang. */
export type SkinModelKind = "default" | "slim";

export function normalizeSkinModel(
  raw: string | null | undefined,
): SkinModelKind {
  return raw === "slim" ? "slim" : "default";
}

export function skinModelLabel(model: SkinModelKind): string {
  return model === "slim" ? "Slim" : "Wide";
}
