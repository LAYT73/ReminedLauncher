import { LOCALES, setLocale, useLocale, useT } from "@/shared/i18n";

export function LanguageSection() {
  const t = useT();
  const locale = useLocale();

  return (
    <div className="settings-block">
      <h3 className="settings-heading">{t("settings.language.title")}</h3>
      <div
        className="theme-mode-seg"
        role="group"
        aria-label={t("settings.language.title")}
      >
        {LOCALES.map((l) => (
          <button
            key={l.id}
            type="button"
            lang={l.id}
            className={`theme-mode-btn${locale === l.id ? " is-active" : ""}`}
            aria-pressed={locale === l.id}
            onClick={() => setLocale(l.id)}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
