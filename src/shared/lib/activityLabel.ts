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

/**
 * Short badge text for a friend row: dimension for singleplayer, "LAN · <dim>",
 * "Сервер · <dim>", "Пауза", "В меню", ... Undefined for an unknown code.
 */
export function activityShortLabel(raw: string | null | undefined): string | undefined {
  const [base, ...rest] = (raw ?? "").trim().split("|");
  if (!(BASE_CODES as readonly string[]).includes(base)) return undefined;
  if (rest.includes("paused")) return t("social.presence.paused");
  const dimCode = rest.find((s) => (DIMS as readonly string[]).includes(s));
  const dim = dimCode ? t(DIM_KEYS[dimCode as (typeof DIMS)[number]]) : undefined;
  switch (base) {
    case "sp":
      return dim;
    case "lan":
      return dim ? `${t("social.presence.badgeLan")} · ${dim}` : t("social.presence.badgeLan");
    case "mp":
      return dim ? `${t("social.presence.badgeServer")} · ${dim}` : t("social.presence.badgeServer");
    case "menu":
      return t("social.presence.badgeMenu");
    case "loading":
      return t("social.presence.badgeLoading");
    case "death":
      return t("social.presence.activity.death");
    case "advancement":
      return t("social.presence.activity.advancement");
    default:
      return undefined;
  }
}
