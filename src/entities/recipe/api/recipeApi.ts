import { call } from "@/shared/api/invoke";
import { CMD } from "@/shared/config/commands";
import type { RecipeIndex, RecipeLocale, RecipeSource } from "../model/types";

/** Plain browser (npm run dev, no Tauri): serve a small fixture instead of invoking Rust. */
const noTauri = () => typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);

/** Parsed index per cache path; only the latest path of each pack|locale is kept. */
const parsed = new Map<string, RecipeIndex>();
const latest = new Map<string, string>();

export type LoadedIndex = { path: string; index: RecipeIndex };

export const recipeApi = {
  async listSources(): Promise<RecipeSource[]> {
    if (noTauri()) return (await import("../fixtures/mock")).mockSources();
    return call<RecipeSource[]>(CMD.recipeSources);
  },

  /**
   * Always asks Rust for the index path (cheap when cached; its fingerprint notices pack updates and
   * mod toggles). The JSON is read and parsed only when the path is new.
   */
  async loadIndex(packId: string, locale: RecipeLocale, force = false): Promise<LoadedIndex> {
    const key = `${packId}|${locale}`;
    if (noTauri()) return (await import("../fixtures/mock")).mockIndex(locale, packId);
    const path = await call<string>(CMD.recipeIndex, { packId, locale, force });
    let index = force ? undefined : parsed.get(path);
    if (!index) {
      const text = await call<string>(CMD.recipeReadIndex, { path });
      index = JSON.parse(text) as RecipeIndex;
      const old = latest.get(key);
      if (old && old !== path) parsed.delete(old);
      parsed.set(path, index);
      latest.set(key, path);
    }
    return { path, index };
  },
};
