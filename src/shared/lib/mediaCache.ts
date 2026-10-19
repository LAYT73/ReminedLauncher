import { call } from "@/shared/api/invoke";
import { CMD } from "@/shared/config/commands";

const map = new Map<string, string>();

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

export function mediaSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  if (!u) return null;
  return map.get(u) ?? u;
}

export function mediaSrcRequired(url: string): string {
  return map.get(url.trim()) ?? url;
}

/** The media fields of a catalog pack that get cached on disk. */
export type MediaPack = {
  logo_url: string | null;
  wallpaper_url: string | null;
  gallery: string[];
};

export function collectPackMediaUrls(pack: MediaPack): string[] {
  const out: string[] = [];
  if (pack.logo_url) out.push(pack.logo_url);
  if (pack.wallpaper_url) out.push(pack.wallpaper_url);
  for (const g of pack.gallery) {
    if (g) out.push(g);
  }
  return out;
}

export function collectCatalogMediaUrls(packs: MediaPack[]): string[] {
  const set = new Set<string>();
  for (const p of packs) {
    for (const u of collectPackMediaUrls(p)) {
      if (isHttp(u)) set.add(u.trim());
    }
  }
  return [...set];
}

function merge( partial: Record<string, string>) {
  for (const [k, v] of Object.entries(partial)) {
    if (v) map.set(k, v);
  }
}

/** Offline: only disk hits. */
export async function resolveMediaFromDisk(urls: string[]): Promise<void> {
  const list = [...new Set(urls.map((u) => u.trim()).filter(isHttp))];
  if (list.length === 0) return;
  try {
    const found = await call<Record<string, string>>(CMD.resolveMediaCache, {
      urls: list,
    });
    merge(found);
  } catch (err) {
    console.warn("resolve_media_cache", err);
  }
}

/** Online: refresh from network into `.remined/cache/media/` (disk = fallback). */
export async function warmMediaCache(urls: string[]): Promise<void> {
  const list = [...new Set(urls.map((u) => u.trim()).filter(isHttp))];
  if (list.length === 0) return;
  try {
    const found = await call<Record<string, string>>(CMD.cacheMediaUrls, {
      urls: list,
    });
    merge(found);
  } catch (err) {
    console.warn("cache_media_urls", err);
    await resolveMediaFromDisk(list);
  }
}

/** Rewrite catalog image fields to local data-URLs when cached. */
export function localizeCatalogPack<T extends MediaPack>(pack: T): T {
  return {
    ...pack,
    logo_url: mediaSrc(pack.logo_url),
    wallpaper_url: mediaSrc(pack.wallpaper_url),
    gallery: pack.gallery.map((u) => mediaSrcRequired(u)),
  };
}

export function localizeCatalog<T extends MediaPack>(packs: T[]): T[] {
  return packs.map(localizeCatalogPack);
}
