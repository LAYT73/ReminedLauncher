import { create } from "zustand";
import {
  IconRenderer,
  buildLookup,
  recipeApi,
  type RecipeLocale,
  type RecipeLookup,
  type RecipeSource,
} from "@/entities/recipe";

export type ViewMode = "recipes" | "uses";
export type View = { itemId: string; mode: ViewMode; tab: string | null; page: number };
export type Tip = { id: string; tag?: string };
export type Status = "idle" | "loading" | "ready" | "error";

interface State {
  sources: RecipeSource[];
  sourcesLoaded: boolean;
  sourcesError: string | null;
  /** Pack the sidebar currently has selected (page is bound to it). */
  packId: string | null;

  status: Status;
  error: string | null;
  lookup: RecipeLookup | null;
  icons: IconRenderer | null;
  /** `pack|locale|path` of the loaded lookup: same key => reuse lookup + icon cache. */
  loadedKey: string | null;

  query: string;
  modFilter: string;

  view: View | null;
  history: View[];
  /** Item under the pointer (tooltip + R/U hotkeys). */
  tip: Tip | null;

  initSources: () => Promise<void>;
  setPack: (packId: string | null) => void;
  load: (locale: RecipeLocale, force?: boolean) => Promise<void>;
  setQuery: (q: string) => void;
  setModFilter: (id: string) => void;
  open: (itemId: string, mode: ViewMode) => void;
  back: () => void;
  setTab: (tab: string) => void;
  setPage: (page: number) => void;
  setTip: (tip: Tip | null) => void;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Per pack|locale: the last built lookup + icon cache, so switching packs back is instant. */
const built = new Map<string, { key: string; lookup: RecipeLookup; icons: IconRenderer }>();

let loadSeq = 0;

export const useRecipesStore = create<State>((set, get) => ({
  sources: [],
  sourcesLoaded: false,
  sourcesError: null,
  packId: null,
  status: "idle",
  error: null,
  lookup: null,
  icons: null,
  loadedKey: null,
  query: "",
  modFilter: "",
  view: null,
  history: [],
  tip: null,

  async initSources() {
    try {
      const sources = await recipeApi.listSources();
      set({ sources, sourcesLoaded: true, sourcesError: null });
    } catch (e) {
      set({ sourcesLoaded: true, sourcesError: errText(e) });
    }
  },

  setPack(packId) {
    if (packId === get().packId) return;
    set({ packId, view: null, history: [], modFilter: "", status: "idle", error: null });
  },

  async load(locale, force = false) {
    const packId = get().packId;
    if (!packId) return;
    const seq = ++loadSeq;
    const base = `${packId}|${locale}`;
    const hit = built.get(base);
    if (hit && !force) {
      // Show the cached build right away; revalidate below (cheap when nothing changed).
      set({ status: "ready", error: null, lookup: hit.lookup, icons: hit.icons, loadedKey: hit.key });
    } else {
      set({ status: "loading", error: null });
    }
    try {
      const { path, index } = await recipeApi.loadIndex(packId, locale, force);
      if (seq !== loadSeq) return;
      const key = `${base}|${path}`;
      const cur = built.get(base);
      if (cur && cur.key === key && !force) {
        set({ status: "ready", lookup: cur.lookup, icons: cur.icons, loadedKey: key });
        return;
      }
      const lookup = buildLookup(index);
      const icons = new IconRenderer(index, lookup.itemsById);
      cur?.icons.dispose();
      built.set(base, { key, lookup, icons });
      const prev = get().view;
      const keep = prev && lookup.itemsById.has(prev.itemId);
      set({
        status: "ready",
        loadedKey: key,
        lookup,
        icons,
        ...(keep ? {} : { view: null, history: [] }),
      });
    } catch (e) {
      if (seq !== loadSeq) return;
      set({ status: "error", error: errText(e) });
    }
  },
  setQuery: (query) => set({ query }),
  setModFilter: (modFilter) => set({ modFilter }),

  open(itemId, mode) {
    const { view, history } = get();
    if (view && view.itemId === itemId && view.mode === mode) return;
    set({
      history: view ? [...history.slice(-49), view] : history,
      view: { itemId, mode, tab: null, page: 0 },
    });
  },

  back() {
    const { history } = get();
    if (history.length === 0) {
      if (get().view) set({ view: null });
      return;
    }
    set({ view: history[history.length - 1], history: history.slice(0, -1) });
  },

  setTab(tab) {
    const v = get().view;
    if (v) set({ view: { ...v, tab, page: 0 } });
  },

  setPage(page) {
    const v = get().view;
    if (v) set({ view: { ...v, page } });
  },

  setTip: (tip) => set({ tip }),
}));
