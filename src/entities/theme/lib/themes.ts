export type ThemeId =
  | "dark-green"
  | "dark-purple"
  | "dark-pink"
  | "light-green"
  | "light-pink"
  | "light-purple";

export type ThemePreset = {
  id: ThemeId;
  label: string;
  mode: "dark" | "light";
  accent: string;
  accentMid: string;
  surface: string;
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "dark-pink",
    label: "Dark · Pink",
    mode: "dark",
    accent: "#d9488a",
    accentMid: "#e85a9c",
    surface: "#1c1418",
  },
  {
    id: "dark-purple",
    label: "Dark · Purple",
    mode: "dark",
    accent: "#7b3fe4",
    accentMid: "#9458f0",
    surface: "#1a1624",
  },
  {
    id: "dark-green",
    label: "Dark · Green",
    mode: "dark",
    accent: "#3c8527",
    accentMid: "#4a9c31",
    surface: "#1e1e1e",
  },
  {
    id: "light-pink",
    label: "Light · Pink",
    mode: "light",
    accent: "#d9488a",
    accentMid: "#e85a9c",
    surface: "#fff5f9",
  },
  {
    id: "light-purple",
    label: "Light · Purple",
    mode: "light",
    accent: "#7b3fe4",
    accentMid: "#9458f0",
    surface: "#f6f2ff",
  },
  {
    id: "light-green",
    label: "Light · Green",
    mode: "light",
    accent: "#3c8527",
    accentMid: "#4a9c31",
    surface: "#f3f3f0",
  },
];

export const DEFAULT_THEME: ThemeId = "dark-pink";

export function normalizeThemeId(raw: unknown): ThemeId {
  const id = String(raw ?? "");
  return THEME_PRESETS.some((t) => t.id === id)
    ? (id as ThemeId)
    : DEFAULT_THEME;
}

export function applyTheme(themeId: ThemeId) {
  const root = document.documentElement;
  root.setAttribute("data-theme", themeId);
  root.style.colorScheme = themeId.startsWith("light") ? "light" : "dark";
}
