import { create } from "zustand";
import { STORAGE_KEY } from "@/shared/config/storage-keys";
import { getLocale, t } from "@/shared/i18n";
import { toast } from "@/shared/lib/toast";
import { schematicApi, type Catalog, type SchematicEntry } from "@/entities/schematic";
import { clearThumbs } from "./catalog";
import { fileName, isSupportedPath, localizedError } from "./format";
import {
  readCollapsedPrefs,
  readLastId,
  readLayer,
  readPanelPrefs,
  readSource,
  readTape,
  readViewPrefs,
  writeCollapsedPrefs,
  writeLastId,
  writeLayer,
  writePanelPrefs,
  writeSource,
  writeTape,
  writeViewPrefs,
  type BelowMode,
  type MatScope,
  type PanelTab,
  type Source,
  type ViewMode,
} from "./prefs";

export type CatalogStatus = "idle" | "loading" | "ready" | "error";

interface State {
  entries: SchematicEntry[];
  listLoaded: boolean;
  selectedId: string | null;
  /** Current layer (y, 0-based) of the selected schematic. */
  layer: number;
  /** Non-air block count per layer of the loaded schematic (index = y). */
  layerCounts: number[];

  mode: ViewMode;
  below: BelowMode;
  showAbove: boolean;
  grid: boolean;
  skipEmpty: boolean;
  /** Orthographic camera (session only). */
  ortho: boolean;
  /** Measuring tape tool active. */
  tape: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;

  panelTab: PanelTab;
  matScope: MatScope;
  drawerOpen: boolean;
  importing: boolean;
  /** Session-only "collected" marks in the materials list. */
  collected: Record<string, true>;

  /** Left panel / center area source: personal library or built-in catalog. */
  source: Source;
  catalogStatus: CatalogStatus;
  catalog: Catalog | null;
  catalogError: string | null;
  /** The shown catalog is the saved copy (last refresh failed). */
  catalogStale: boolean;
  /** "all" or a category id. */
  catalogCategory: string;
  catalogQuery: string;
  /** Catalog item ids being installed right now. */
  installing: Record<string, true>;
  /** Catalog item shown in the details modal. */
  catalogDetailId: string | null;

  setSource: (s: Source) => void;
  loadCatalog: (force?: boolean) => Promise<void>;
  setCatalogCategory: (id: string) => void;
  setCatalogQuery: (q: string) => void;
  setCatalogDetailId: (id: string | null) => void;
  installCatalogItem: (itemId: string) => Promise<void>;
  openInstalled: (catalogId: string) => void;
  refresh: () => Promise<void>;
  select: (id: string | null) => void;
  importPaths: (paths: string[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  setLayerCounts: (counts: number[]) => void;
  setLayer: (y: number) => void;
  stepLayer: (dir: 1 | -1) => void;
  toggleBuilt: (y: number) => Promise<void>;
  completeLayer: () => Promise<void>;
  setMode: (m: ViewMode) => void;
  setBelow: (b: BelowMode) => void;
  setShowAbove: (v: boolean) => void;
  setGrid: (v: boolean) => void;
  setSkipEmpty: (v: boolean) => void;
  setOrtho: (v: boolean) => void;
  setTape: (v: boolean) => void;
  setLeftCollapsed: (v: boolean) => void;
  setRightCollapsed: (v: boolean) => void;
  setPanelTab: (tab: PanelTab) => void;
  setMatScope: (s: MatScope) => void;
  setDrawerOpen: (v: boolean) => void;
  toggleCollected: (key: string) => void;
}

const view0 = readViewPrefs();
const panel0 = readPanelPrefs();
const collapsed0 = readCollapsedPrefs();

export const useSchematicsStore = create<State>((set, get) => {
  const saveView = () => {
    const s = get();
    writeViewPrefs({
      mode: s.mode,
      below: s.below,
      showAbove: s.showAbove,
      grid: s.grid,
      skipEmpty: s.skipEmpty,
    });
  };
  const savePanel = () => {
    const s = get();
    writePanelPrefs({ tab: s.panelTab, scope: s.matScope });
  };
  const upsert = (entry: SchematicEntry) =>
    set((s) => ({
      entries: s.entries.some((e) => e.id === entry.id)
        ? s.entries.map((e) => (e.id === entry.id ? entry : e))
        : [entry, ...s.entries],
    }));

  const clampLayer = (y: number) => {
    const n = get().layerCounts.length;
    return n === 0 ? Math.max(0, y) : Math.min(Math.max(0, y), n - 1);
  };

  return {
    entries: [],
    listLoaded: false,
    selectedId: null,
    layer: 0,
    layerCounts: [],

    mode: view0.mode,
    below: view0.below,
    showAbove: view0.showAbove,
    grid: view0.grid,
    skipEmpty: view0.skipEmpty,
    ortho: false,
    tape: readTape(),
    leftCollapsed: collapsed0.left,
    rightCollapsed: collapsed0.right,

    panelTab: panel0.tab,
    matScope: panel0.scope,
    drawerOpen: false,
    importing: false,
    collected: {},

    source: readSource(),
    catalogStatus: "idle",
    catalog: null,
    catalogError: null,
    catalogStale: false,
    catalogCategory: "all",
    catalogQuery: "",
    installing: {},
    catalogDetailId: null,

    setSource(source) {
      if (source === get().source) return;
      set({ source, catalogDetailId: null });
      writeSource(source);
      if (source === "catalog" && get().catalogStatus === "idle") void get().loadCatalog();
    },

    async loadCatalog(force = false) {
      if (get().catalogStatus === "loading") return;
      set({ catalogStatus: "loading", catalogError: null });
      try {
        const { catalog, stale } = await schematicApi.catalog(force);
        const { catalogCategory } = get();
        const resetCategory =
          catalogCategory !== "all" && !catalog.categories.some((c) => c.id === catalogCategory);
        set({
          catalog,
          catalogStale: stale,
          catalogStatus: "ready",
          ...(resetCategory ? { catalogCategory: "all" } : {}),
        });
        if (force && !stale) clearThumbs();
        if (force) {
          if (stale) toast(t("schematics.catalog.refreshStale"), "err");
          else toast(t("schematics.catalog.refreshed"), "ok");
        }
      } catch (err) {
        if (get().catalog && force) {
          // Keep showing what we have.
          set({ catalogStatus: "ready" });
          toast(localizedError(err), "err");
        } else {
          set({ catalogStatus: "error", catalogError: localizedError(err) });
        }
      }
    },

    setCatalogCategory: (catalogCategory) => set({ catalogCategory }),
    setCatalogQuery: (catalogQuery) => set({ catalogQuery }),
    setCatalogDetailId: (catalogDetailId) => set({ catalogDetailId }),

    async installCatalogItem(itemId) {
      if (get().installing[itemId]) return;
      set((s) => ({ installing: { ...s.installing, [itemId]: true } }));
      try {
        const entry = await schematicApi.install(itemId, getLocale());
        upsert(entry);
        toast(t("schematics.catalog.added"), "ok");
      } catch (err) {
        toast(localizedError(err), "err");
      } finally {
        set((s) => {
          const next = { ...s.installing };
          delete next[itemId];
          return { installing: next };
        });
      }
    },

    openInstalled(catalogId) {
      const entry = get().entries.find((e) => e.catalogId === catalogId);
      if (!entry) return;
      get().select(entry.id);
      get().setSource("mine");
    },

    async refresh() {
      try {
        const entries = await schematicApi.list();
        const sorted = [...entries].sort((a, b) => b.importedAt.localeCompare(a.importedAt));
        set({ entries: sorted, listLoaded: true });
        const { selectedId } = get();
        if (!selectedId || !sorted.some((e) => e.id === selectedId)) {
          const last = readLastId();
          const pick = sorted.find((e) => e.id === last) ?? sorted[0] ?? null;
          get().select(pick?.id ?? null);
        }
      } catch (err) {
        set({ listLoaded: true });
        toast(t("schematics.library.loadListFailed", { error: localizedError(err) }), "err");
      }
    },

    select(id) {
      if (id === get().selectedId) return;
      writeLastId(id);
      set({
        selectedId: id,
        layer: id ? readLayer(id) : 0,
        layerCounts: [],
        collected: {},
      });
    },

    async importPaths(paths) {
      const supported = paths.filter(isSupportedPath);
      if (supported.length === 0) {
        if (paths.length > 0) toast(t("schematics.library.unsupported"), "err");
        return;
      }
      set({ importing: true });
      const failures: string[] = [];
      let last: SchematicEntry | null = null;
      for (const path of supported) {
        try {
          const entry = await schematicApi.import(path);
          upsert(entry);
          last = entry;
        } catch (err) {
          failures.push(
            t("schematics.library.importFailed", {
              name: fileName(path),
              error: localizedError(err),
            }),
          );
        }
      }
      set({ importing: false });
      if (last) get().select(last.id);
      if (failures.length > 0) toast(failures.join("\n"), "err");
      else if (last) toast(t("schematics.library.imported", { name: last.name }), "ok");
    },

    async remove(id) {
      try {
        await schematicApi.remove(id);
      } catch (err) {
        toast(localizedError(err), "err");
        return;
      }
      try {
        localStorage.removeItem(STORAGE_KEY.schematicsLayerPrefix + id);
      } catch {
        /* ignore */
      }
      const rest = get().entries.filter((e) => e.id !== id);
      set({ entries: rest });
      if (get().selectedId === id) {
        get().select(rest[0]?.id ?? null);
      }
    },

    async rename(id, name) {
      const trimmed = name.trim();
      const cur = get().entries.find((e) => e.id === id);
      if (!cur || !trimmed || trimmed === cur.name) return;
      try {
        await schematicApi.rename(id, trimmed);
        upsert({ ...cur, name: trimmed });
      } catch (err) {
        toast(localizedError(err), "err");
      }
    },

    setLayerCounts(counts) {
      set({ layerCounts: counts });
      const y = clampLayer(get().layer);
      if (y !== get().layer) set({ layer: y });
    },

    setLayer(y) {
      const next = clampLayer(y);
      if (next === get().layer) return;
      set({ layer: next });
      const id = get().selectedId;
      if (id) writeLayer(id, next);
    },

    stepLayer(dir) {
      const { layer, layerCounts, skipEmpty } = get();
      let y = layer + dir;
      if (skipEmpty) {
        while (y >= 0 && y < layerCounts.length && layerCounts[y] === 0) y += dir;
        if (y < 0 || y >= layerCounts.length) return;
      }
      get().setLayer(y);
    },

    async toggleBuilt(y) {
      const { selectedId, entries } = get();
      const cur = entries.find((e) => e.id === selectedId);
      if (!cur) return;
      const flip = (list: number[]) => {
        const built = new Set(list);
        if (built.has(y)) built.delete(y);
        else built.add(y);
        return [...built].sort((a, b) => a - b);
      };
      const layers = flip(cur.builtLayers);
      upsert({ ...cur, builtLayers: layers });
      try {
        await schematicApi.setBuilt(cur.id, layers);
      } catch (err) {
        const latest = get().entries.find((e) => e.id === cur.id);
        if (latest) upsert({ ...latest, builtLayers: flip(latest.builtLayers) });
        toast(t("schematics.steps.saveFailed", { error: localizedError(err) }), "err");
      }
    },

    async completeLayer() {
      const { selectedId, entries, layer } = get();
      const cur = entries.find((e) => e.id === selectedId);
      if (!cur) return;
      if (!cur.builtLayers.includes(layer)) await get().toggleBuilt(layer);
      // Advance only if the user is still on the layer we marked.
      if (get().selectedId === cur.id && get().layer === layer) get().stepLayer(1);
    },

    setMode(mode) {
      set({ mode });
      saveView();
    },
    setBelow(below) {
      set({ below });
      saveView();
    },
    setShowAbove(showAbove) {
      set({ showAbove });
      saveView();
    },
    setGrid(grid) {
      set({ grid });
      saveView();
    },
    setSkipEmpty(skipEmpty) {
      set({ skipEmpty });
      saveView();
    },
    setOrtho: (ortho) => set({ ortho }),
    setTape(tape) {
      set({ tape });
      writeTape(tape);
    },
    setLeftCollapsed(leftCollapsed) {
      set({ leftCollapsed });
      writeCollapsedPrefs({ left: leftCollapsed, right: get().rightCollapsed });
    },
    setRightCollapsed(rightCollapsed) {
      set({ rightCollapsed });
      writeCollapsedPrefs({ left: get().leftCollapsed, right: rightCollapsed });
    },
    setPanelTab(panelTab) {
      set({ panelTab });
      savePanel();
    },
    setMatScope(matScope) {
      set({ matScope });
      savePanel();
    },
    setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
    toggleCollected(key) {
      set((s) => {
        const next = { ...s.collected };
        if (next[key]) delete next[key];
        else next[key] = true;
        return { collected: next };
      });
    },
  };
});
