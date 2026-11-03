import { STORAGE_KEY } from "@/shared/config/storage-keys";

export type BelowMode = "dim" | "normal" | "hide";
export type ViewMode = "layers" | "whole";
export type PanelTab = "materials" | "steps";
export type Source = "mine" | "catalog";
export type MatScope = "layer" | "total";

export interface ViewPrefs {
  mode: ViewMode;
  below: BelowMode;
  showAbove: boolean;
  grid: boolean;
  skipEmpty: boolean;
}

export interface PanelPrefs {
  tab: PanelTab;
  scope: MatScope;
}

const DEFAULT_VIEW: ViewPrefs = {
  mode: "layers",
  below: "dim",
  showAbove: false,
  grid: true,
  skipEmpty: false,
};

export interface CollapsedPrefs {
  left: boolean;
  right: boolean;
}

const DEFAULT_COLLAPSED: CollapsedPrefs = { left: false, right: false };

const DEFAULT_PANEL: PanelPrefs = { tab: "materials", scope: "layer" };

function readJson<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object") return { ...fallback, ...(v as Partial<T>) };
  } catch {
    /* ignore */
  }
  return fallback;
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export const readViewPrefs = () => readJson(STORAGE_KEY.schematicsView, DEFAULT_VIEW);
export const writeViewPrefs = (p: ViewPrefs) =>
  write(STORAGE_KEY.schematicsView, JSON.stringify(p));
export const readPanelPrefs = () => readJson(STORAGE_KEY.schematicsPanel, DEFAULT_PANEL);
export const writePanelPrefs = (p: PanelPrefs) =>
  write(STORAGE_KEY.schematicsPanel, JSON.stringify(p));

export const readCollapsedPrefs = () => readJson(STORAGE_KEY.schematicsCollapsed, DEFAULT_COLLAPSED);
export const writeCollapsedPrefs = (p: CollapsedPrefs) =>
  write(STORAGE_KEY.schematicsCollapsed, JSON.stringify(p));

export function readLastId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY.schematicsLast);
  } catch {
    return null;
  }
}

export function writeLastId(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY.schematicsLast, id);
    else localStorage.removeItem(STORAGE_KEY.schematicsLast);
  } catch {
    /* ignore */
  }
}

export function readLayer(id: string): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY.schematicsLayerPrefix + id));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function writeLayer(id: string, y: number) {
  write(STORAGE_KEY.schematicsLayerPrefix + id, String(y));
}

export function readTape(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY.schematicsTape) === "1";
  } catch {
    return false;
  }
}

export function writeTape(on: boolean) {
  write(STORAGE_KEY.schematicsTape, on ? "1" : "0");
}

export function readSource(): Source {
  try {
    return localStorage.getItem(STORAGE_KEY.schematicsSource) === "catalog" ? "catalog" : "mine";
  } catch {
    return "mine";
  }
}

export function writeSource(s: Source) {
  write(STORAGE_KEY.schematicsSource, s);
}
