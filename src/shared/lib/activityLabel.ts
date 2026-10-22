import { t } from "@/shared/i18n";

const BASE_CODES = ["loading", "menu", "sp", "lan", "mp", "death", "advancement"] as const;
const DIMS = ["overworld", "nether", "end", "other"] as const;

const DIM_KEYS = {
  overworld: "social.presence.dimOverworld",
  nether: "social.presence.dimNether",
  end: "social.presence.dimEnd",
  other: "social.presence.dimOther",
} as const;

/**
 * Localized activity text from `base[|dim][|paused]` (e.g. "sp|nether|paused"),
 * or undefined for an unknown base code. Unknown extra segments are ignored.
 */
export function activityLabel(raw: string | null | undefined): string | undefined {
  const [base, ...rest] = (raw ?? "").trim().split("|");
  if (!(BASE_CODES as readonly string[]).includes(base)) return undefined;
  const parts = [t(`social.presence.activity.${base}` as "social.presence.activity.menu")];
  const dim = rest.find((s) => (DIMS as readonly string[]).includes(s));
  if (dim) parts.push(t(DIM_KEYS[dim as (typeof DIMS)[number]]));
  if (rest.includes("paused")) parts.push(t("social.presence.paused"));
  return parts.join(" · ");
}
