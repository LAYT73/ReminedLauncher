import type { CatalogItem, LocalizedText } from "@/entities/schematic";
import type { Locale } from "@/shared/i18n";

/** ru when the app locale is ru, else en; falls back to the other language. */
export function localized(text: LocalizedText | undefined, locale: Locale): string {
  if (!text) return "";
  const [a, b] = locale === "ru" ? [text.ru, text.en] : [text.en, text.ru];
  return a?.trim() ? a : (b ?? "");
}

export function matchesQuery(item: CatalogItem, q: string, locale: Locale): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    item.name.ru,
    item.name.en,
    localized(item.description, locale),
    item.author,
    ...item.tags,
  ]
    .join("\n")
    .toLowerCase();
  return hay.includes(needle);
}

/** Successful thumbnail data URLs by item id (failures are never cached). */
export const thumbCache = new Map<string, string>();
const thumbListeners = new Set<() => void>();

export function setThumb(id: string, url: string) {
  thumbCache.set(id, url);
  thumbListeners.forEach((l) => l());
}

export function clearThumbs() {
  thumbCache.clear();
  thumbListeners.forEach((l) => l());
}

export function subscribeThumbs(l: () => void) {
  thumbListeners.add(l);
  return () => void thumbListeners.delete(l);
}
