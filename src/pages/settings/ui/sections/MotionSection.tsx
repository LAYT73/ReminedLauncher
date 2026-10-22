import { useT } from "@/shared/i18n";
import { McToggle } from "@/shared/ui/McToggle";
import { playPageTransitionPreview } from "@/shared/lib/pageTransition";
import {
  PAGE_TRANSITION_SPEEDS,
  usePageTransitionPrefs,
} from "@/shared/lib/pageTransitionPrefs";

function systemReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function MotionSection() {
  const t = useT();
  const enabled = usePageTransitionPrefs((s) => s.enabled);
  const speed = usePageTransitionPrefs((s) => s.speed);
  const setEnabled = usePageTransitionPrefs((s) => s.setEnabled);
  const setSpeed = usePageTransitionPrefs((s) => s.setSpeed);
  const reduced = systemReducedMotion();

  return (
    <div className="settings-block">
      <h3 className="settings-heading">{t("settings.motion.title")}</h3>
      <McToggle
        checked={enabled}
        onChange={setEnabled}
        label={t("settings.motion.pageTransitions")}
      />
      <div
        className={`motion-speed-row${enabled ? "" : " is-disabled"}`}
      >
        <span className="theme-custom-label">{t("settings.motion.speed")}</span>
        <div
          className="theme-mode-seg"
          role="group"
          aria-label={t("settings.motion.speedAria")}
        >
          {PAGE_TRANSITION_SPEEDS.map((id) => (
            <button
              key={id}
              type="button"
              className={`theme-mode-btn${speed === id ? " is-active" : ""}`}
              aria-pressed={speed === id}
              disabled={!enabled}
              onClick={() => setSpeed(id)}
            >
              {t(`settings.motion.${id}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="theme-mode-btn motion-preview-btn"
          disabled={!enabled || reduced}
          onClick={playPageTransitionPreview}
        >
          {t("settings.motion.preview")}
        </button>
      </div>
      {reduced ? (
        <p className="motion-hint">
          {t("settings.motion.reducedHint")}
        </p>
      ) : null}
    </div>
  );
}
