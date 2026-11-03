import { getLocale, t } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/errors";

export const SCHEMATIC_EXTENSIONS = ["litematic", "schem", "nbt"] as const;

export function isSupportedPath(path: string): boolean {
  const ext = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
  return (SCHEMATIC_EXTENSIONS as readonly string[]).includes(ext);
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Backend errors are "Русский / English"; show the part for the current locale. */
export function localizedError(err: unknown): string {
  const raw = errorMessage(err);
  const parts = raw.split(" / ");
  if (parts.length < 2) return raw;
  return (getLocale() === "ru" ? parts[0] : parts.slice(1).join(" / ")).trim();
}

/** Items per stack in Minecraft for a material (item id without namespace). */
export function stackSize(name: string): number {
  if (name === "bucket") return 16;
  if (
    name.endsWith("_bucket") ||
    name.endsWith("_bed") ||
    name.endsWith("shulker_box") ||
    name === "cake"
  ) {
    return 1;
  }
  if (
    name.endsWith("_sign") ||
    name.endsWith("_banner") ||
    name === "egg" ||
    name === "ender_pearl" ||
    name === "snowball" ||
    name === "armor_stand" ||
    name === "honey_bottle"
  ) {
    return 16;
  }
  return 64;
}

/** "3 st. + 12", "2 st." or an empty string when it fits in one stack. */
export function formatStacks(name: string, count: number): string {
  const size = stackSize(name);
  if (size <= 1 || count < size) return "";
  const stacks = Math.floor(count / size);
  const rest = count % size;
  return rest === 0
    ? t("schematics.materials.stacksOnly", { stacks })
    : t("schematics.materials.stacks", { stacks, rest });
}
