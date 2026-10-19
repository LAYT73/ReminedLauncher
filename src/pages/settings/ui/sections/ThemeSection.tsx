import { setTheme } from "@/features/profile-edit";
import { useProfileStore } from "@/entities/profile";
import { THEME_PRESETS } from "@/entities/theme";

export function ThemeSection() {
  const theme = useProfileStore((s) => s.profile.theme);

  return (
    <div className="settings-block">
      <h3 className="settings-heading">Theme</h3>
      <div className="theme-grid" role="listbox" aria-label="Theme presets">
        {THEME_PRESETS.map((preset) => {
          const active = theme === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              role="option"
              aria-selected={active}
              aria-label={preset.label}
              title={preset.label}
              className={`theme-card ${active ? "is-active" : ""}`}
              onClick={() => void setTheme(preset.id)}
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
      </div>
    </div>
  );
}
