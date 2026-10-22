import { useEffect, useState } from "react";
import { useT } from "@/shared/i18n";
import { setCustomTheme, setTheme } from "@/features/profile-edit";
import { useProfileStore } from "@/entities/profile";
import {
  DEFAULT_CUSTOM_THEME,
  DEFAULT_THEME,
  THEME_PRESETS,
  parseHex,
  type CustomTheme,
} from "@/entities/theme";

/** Default surface when flipping Light / Dark on a custom theme. */
const MODE_SURFACE = {
  dark: "#1c1519",
  light: "#f3f3f0",
} as const;

function commitHex(
  field: "accent" | "surface",
  raw: string,
  setDraftHex: (v: string) => void,
) {
  const trimmed = raw.trim();
  setDraftHex(trimmed);
  if (parseHex(trimmed)) void setCustomTheme({ [field]: trimmed });
}

export function ThemeSection() {
  const t = useT();
  const theme = useProfileStore((s) => s.profile.theme);
  const custom = useProfileStore((s) => s.profile.theme_custom);
  const draft: CustomTheme = custom ?? DEFAULT_CUSTOM_THEME;
  const customActive = theme === "custom";
  const [editorOpen, setEditorOpen] = useState(customActive);
  const [accentHex, setAccentHex] = useState(draft.accent);
  const [surfaceHex, setSurfaceHex] = useState(draft.surface);

  useEffect(() => {
    if (!customActive) setEditorOpen(false);
  }, [customActive]);

  useEffect(() => {
    setAccentHex(draft.accent);
    setSurfaceHex(draft.surface);
  }, [draft.accent, draft.surface]);

  function pickPreset(id: (typeof THEME_PRESETS)[number]["id"]) {
    setEditorOpen(false);
    void setTheme(id);
  }

  function toggleCustomEditor() {
    if (customActive && editorOpen) {
      setEditorOpen(false);
      void setTheme(DEFAULT_THEME);
      return;
    }
    const next = custom ?? DEFAULT_CUSTOM_THEME;
    setAccentHex(next.accent);
    setSurfaceHex(next.surface);
    setEditorOpen(true);
    void setCustomTheme(next);
  }

  function setMode(mode: "dark" | "light") {
    const surface = MODE_SURFACE[mode];
    setSurfaceHex(surface);
    void setCustomTheme({ mode, surface });
  }

  return (
    <div className="settings-block">
      <h3 className="settings-heading">{t("settings.theme.title")}</h3>
      <div className="theme-grid" role="listbox" aria-label={t("settings.theme.presetsAria")}>
        {THEME_PRESETS.map((preset) => {
          const active = theme === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              role="option"
              aria-selected={active}
              aria-label={t(`settings.theme.presets.${preset.id}`)}
              title={t(`settings.theme.presets.${preset.id}`)}
              className={`theme-card ${active ? "is-active" : ""}`}
              onClick={() => pickPreset(preset.id)}
            >
              <span
                className="theme-swatch"
                style={{
                  background: `linear-gradient(135deg, ${preset.surface} 0 55%, ${preset.accent} 55%)`,
                }}
                aria-hidden
              />
            </button>
          );
        })}
        <button
          type="button"
          role="option"
          aria-selected={customActive && editorOpen}
          aria-label={t("settings.theme.customAria")}
          title={t("settings.theme.custom")}
          className={`theme-card theme-card-custom ${customActive && editorOpen ? "is-active" : ""}`}
          onClick={toggleCustomEditor}
        >
          <span className="theme-swatch theme-swatch-custom" aria-hidden>
            <span
              className="theme-swatch-half"
              style={{ background: draft.surface }}
            />
            <span
              className="theme-swatch-half is-accent"
              style={{ background: draft.accent }}
            />
            <span className="theme-swatch-plus">+</span>
          </span>
        </button>
      </div>

      {customActive && editorOpen ? (
        <div className="theme-custom-editor" aria-label={t("settings.theme.editorAria")}>
          <div className="theme-custom-row">
            <span className="theme-custom-label">{t("settings.theme.mode")}</span>
            <div className="theme-mode-seg" role="group" aria-label={t("settings.theme.modeAria")}>
              <button
                type="button"
                className={`theme-mode-btn${draft.mode === "dark" ? " is-active" : ""}`}
                onClick={() => setMode("dark")}
              >
                {t("settings.theme.dark")}
              </button>
              <button
                type="button"
                className={`theme-mode-btn${draft.mode === "light" ? " is-active" : ""}`}
                onClick={() => setMode("light")}
              >
                {t("settings.theme.light")}
              </button>
            </div>
          </div>
          <div className="theme-custom-row">
            <label className="theme-custom-label" htmlFor="theme-accent">
              {t("settings.theme.accent")}
            </label>
            <div className="theme-color-field">
              <input
                id="theme-accent"
                type="color"
                value={draft.accent}
                onChange={(e) => {
                  setAccentHex(e.target.value);
                  void setCustomTheme({ accent: e.target.value });
                }}
                aria-label={t("settings.theme.accentColor")}
              />
              <input
                type="text"
                className="theme-color-hex"
                value={accentHex}
                spellCheck={false}
                maxLength={7}
                onChange={(e) => commitHex("accent", e.target.value, setAccentHex)}
                onBlur={() => setAccentHex(draft.accent)}
                aria-label={t("settings.theme.accentHex")}
              />
            </div>
          </div>
          <div className="theme-custom-row">
            <label className="theme-custom-label" htmlFor="theme-surface">
              {t("settings.theme.surface")}
            </label>
            <div className="theme-color-field">
              <input
                id="theme-surface"
                type="color"
                value={draft.surface}
                onChange={(e) => {
                  setSurfaceHex(e.target.value);
                  void setCustomTheme({ surface: e.target.value });
                }}
                aria-label={t("settings.theme.surfaceColor")}
              />
              <input
                type="text"
                className="theme-color-hex"
                value={surfaceHex}
                spellCheck={false}
                maxLength={7}
                onChange={(e) =>
                  commitHex("surface", e.target.value, setSurfaceHex)
                }
                onBlur={() => setSurfaceHex(draft.surface)}
                aria-label={t("settings.theme.surfaceHex")}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
