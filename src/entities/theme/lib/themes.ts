import {
  darken,
  lighten,
  normalizeHex,
  withAlpha,
} from "./color";

export type ThemeId =
  | "dark-green"
  | "dark-purple"
  | "dark-pink"
  | "dark-blue"
  | "light-green"
  | "light-pink"
  | "light-purple"
  | "light-blue"
  | "custom";

export type ThemePreset = {
  id: Exclude<ThemeId, "custom">;
  label: string;
  mode: "dark" | "light";
  accent: string;
  accentMid: string;
  surface: string;
};

export type CustomTheme = {
  mode: "dark" | "light";
  accent: string;
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
    id: "dark-blue",
    label: "Dark · Warden",
    mode: "dark",
    accent: "#019295",
    accentMid: "#27dfe8",
    surface: "#0c1315",
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
    id: "light-blue",
    label: "Light · Warden",
    mode: "light",
    accent: "#019295",
    accentMid: "#27dfe8",
    surface: "#eef8f9",
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

export const DEFAULT_CUSTOM_THEME: CustomTheme = {
  mode: "dark",
  accent: "#d9488a",
  surface: "#1c1519",
};

export function normalizeThemeId(raw: unknown): ThemeId {
  const id = String(raw ?? "");
  if (id === "custom") return "custom";
  return THEME_PRESETS.some((t) => t.id === id)
    ? (id as ThemeId)
    : DEFAULT_THEME;
}

export function normalizeCustomTheme(
  raw: Partial<CustomTheme> | null | undefined,
): CustomTheme {
  const mode = raw?.mode === "light" ? "light" : "dark";
  return {
    mode,
    accent: normalizeHex(raw?.accent ?? "", DEFAULT_CUSTOM_THEME.accent),
    surface: normalizeHex(raw?.surface ?? "", DEFAULT_CUSTOM_THEME.surface),
  };
}

const CUSTOM_STYLE_KEYS = [
  "--mc-green",
  "--mc-green-mid",
  "--mc-green-hi",
  "--accent-deep",
  "--accent-shadow",
  "--accent-text",
  "--accent-wash",
  "--bg",
  "--bg-deep",
  "--bg-sidebar",
  "--bg-panel",
  "--bg-raised",
  "--bg-playbar",
  "--bg-input",
  "--bg-menu",
  "--pack-about-end",
  "--mc-stone",
  "--mc-stone-mid",
  "--mc-stone-hi",
  "--text",
  "--text-secondary",
  "--text-muted",
  "--text-on-stone",
  "--text-on-stone-muted",
  "--chip-bg",
  "--chip-border",
  "--chip-text",
  "--overlay-hover",
  "--caret",
  "--shadow-soft",
] as const;

function clearCustomVars(root: HTMLElement) {
  for (const key of CUSTOM_STYLE_KEYS) {
    root.style.removeProperty(key);
  }
}

function applyCustomVars(root: HTMLElement, custom: CustomTheme) {
  const accent = custom.accent;
  const surface = custom.surface;
  const mid = lighten(accent, 0.12);
  const hi = lighten(accent, 0.28);

  root.style.setProperty("--mc-green", accent);
  root.style.setProperty("--mc-green-mid", mid);
  root.style.setProperty("--mc-green-hi", hi);
  root.style.setProperty("--accent-wash", withAlpha(accent, 0.1));

  if (custom.mode === "dark") {
    const deep = darken(surface, 0.35);
    const panel = lighten(surface, 0.08);
    const raised = lighten(surface, 0.14);
    const sidebar = darken(surface, 0.22);
    const input = darken(surface, 0.45);
    root.style.setProperty("--accent-deep", darken(accent, 0.55));
    root.style.setProperty("--accent-shadow", darken(accent, 0.35));
    root.style.setProperty("--accent-text", hi);
    root.style.setProperty("--bg", surface);
    root.style.setProperty("--bg-deep", deep);
    root.style.setProperty("--bg-sidebar", sidebar);
    root.style.setProperty("--bg-panel", panel);
    root.style.setProperty("--bg-raised", raised);
    root.style.setProperty("--bg-playbar", darken(surface, 0.18));
    root.style.setProperty("--bg-input", input);
    root.style.setProperty("--bg-menu", darken(surface, 0.12));
    root.style.setProperty("--pack-about-end", darken(surface, 0.18));
    root.style.setProperty("--mc-stone", "#2a2a2a");
    root.style.setProperty("--mc-stone-mid", "#383838");
    root.style.setProperty("--mc-stone-hi", "#4a4a4a");
    root.style.setProperty("--text", "#ffffff");
    root.style.setProperty("--text-secondary", "#b1b1b1");
    root.style.setProperty("--text-muted", "#8a8a8a");
    root.style.setProperty("--text-on-stone", "#ffffff");
    root.style.setProperty("--text-on-stone-muted", "#d0d0d0");
    root.style.setProperty("--chip-bg", "rgba(255, 255, 255, 0.06)");
    root.style.setProperty("--chip-border", "rgba(255, 255, 255, 0.14)");
    root.style.setProperty("--chip-text", "#d4d4d4");
    root.style.setProperty("--overlay-hover", "rgba(255, 255, 255, 0.08)");
    root.style.setProperty("--caret", "#ffffff");
    root.style.setProperty("--shadow-soft", "rgba(0, 0, 0, 0.45)");
  } else {
    const deep = darken(surface, 0.06);
    const sidebar = darken(surface, 0.1);
    const panel = lighten(surface, 0.35);
    root.style.setProperty("--accent-deep", lighten(accent, 0.72));
    root.style.setProperty("--accent-shadow", darken(accent, 0.25));
    root.style.setProperty("--accent-text", darken(accent, 0.2));
    root.style.setProperty("--bg", surface);
    root.style.setProperty("--bg-deep", deep);
    root.style.setProperty("--bg-sidebar", sidebar);
    root.style.setProperty("--bg-panel", panel);
    root.style.setProperty("--bg-raised", "#ffffff");
    root.style.setProperty("--bg-playbar", darken(surface, 0.04));
    root.style.setProperty("--bg-input", "#ffffff");
    root.style.setProperty("--bg-menu", "#ffffff");
    root.style.setProperty("--pack-about-end", darken(surface, 0.04));
    root.style.setProperty("--mc-stone", darken(surface, 0.08));
    root.style.setProperty("--mc-stone-mid", darken(surface, 0.12));
    root.style.setProperty("--mc-stone-hi", darken(surface, 0.16));
    root.style.setProperty("--text", "#1a1a1a");
    root.style.setProperty("--text-secondary", "#3a3a3a");
    root.style.setProperty("--text-muted", "#5a5a5a");
    root.style.setProperty("--text-on-stone", "#1a1a1a");
    root.style.setProperty("--text-on-stone-muted", "#5a5a5a");
    root.style.setProperty("--chip-bg", withAlpha(accent, 0.08));
    root.style.setProperty("--chip-border", withAlpha(accent, 0.2));
    root.style.setProperty("--chip-text", darken(accent, 0.25));
    root.style.setProperty("--overlay-hover", "rgba(0, 0, 0, 0.06)");
    root.style.setProperty("--caret", "#1a1a1a");
    root.style.setProperty("--shadow-soft", "transparent");
  }
}

export function applyTheme(
  themeId: ThemeId,
  custom?: CustomTheme | null,
) {
  const root = document.documentElement;
  const id = normalizeThemeId(themeId);
  root.setAttribute("data-theme", id);

  if (id === "custom") {
    const c = normalizeCustomTheme(custom ?? DEFAULT_CUSTOM_THEME);
    root.style.colorScheme = c.mode;
    applyCustomVars(root, c);
    return;
  }

  clearCustomVars(root);
  root.style.colorScheme = id.startsWith("light") ? "light" : "dark";
}
