import type { Locale } from "@/shared/i18n";
import type { PackI18n } from "../model/types";

type Localizable = {
  name: string;
  tagline?: string;
  blurb?: string;
  highlights?: string[];
  i18n?: PackI18n;
};

/** Apply per-locale overrides at render time; missing fields keep base (English) copy. */
export function localizePack<T extends Localizable>(pack: T, locale: Locale): T {
  const o = pack.i18n?.[locale];
  if (!o) return pack;
  const next: T = { ...pack };
  if (o.name?.trim()) next.name = o.name;
  if (o.tagline?.trim() && "tagline" in pack) next.tagline = o.tagline;
  if (o.blurb?.trim() && "blurb" in pack) next.blurb = o.blurb;
  if (o.highlights?.length && "highlights" in pack) next.highlights = o.highlights;
  return next;
}
