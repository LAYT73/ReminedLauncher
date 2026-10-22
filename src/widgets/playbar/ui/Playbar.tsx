import { useT } from "@/shared/i18n";
import { PixelProgress } from "@/shared/ui/PixelProgress";
import { PixelCrossIcon } from "@/shared/ui/PixelIcons";
import { PlayButton } from "@/shared/ui/PlayButton";
import type { Rail } from "@/shared/config/routes";
import { useRail } from "@/shared/lib/useRoute";
import { cancelCurrentInstall, launch, usePlayState } from "@/features/play-game";
import { useGameStore } from "@/entities/game";
import { useInstallStore, useShowProgress } from "@/entities/install";
import { progressPhaseLabel } from "@/entities/pack";
import { PlaybarSelect } from "./PlaybarSelect";

/**
 * Bottom bar: pack/version picker, status or progress, cancel + Play.
 * `rail` pins the bar to a pack rail while it slides out after leaving it.
 */
export function Playbar({ rail: pinned }: { rail?: Rail } = {}) {
  const t = useT();
  const current = useRail();
  const rail = pinned ?? current;
  const play = usePlayState(rail);
  const showProgress = useShowProgress();
  const launching = useGameStore((s) => s.phase === "launching");
  const { installing, percent, phase, message, status, statusKind } =
    useInstallStore();

  return (
    <footer className={`playbar ${showProgress ? "is-installing" : ""}`}>
      <PlaybarSelect rail={rail} />

      {showProgress ? (
        <div className="playbar-progress">
          <PixelProgress
            value={percent}
            phase={progressPhaseLabel(phase) ??
              (phase || (launching ? t("pack.phase.launch") : ""))}
            label={message || status}
          />
        </div>
      ) : (
        <div
          className={`status ${statusKind === "error" ? "error" : ""}`}
          aria-live="polite"
        >
          {status}
        </div>
      )}

      <div className="playbar-actions">
        {installing ? (
          <button
            type="button"
            className="play-cancel"
            title={t("pack.playbar.cancel")}
            aria-label={t("pack.playbar.cancelInstall")}
            onClick={() => void cancelCurrentInstall()}
          >
            <PixelCrossIcon />
          </button>
        ) : null}
        <PlayButton
          kind={play.kind}
          label={play.label}
          disabled={play.disabled}
          onClick={() => void launch()}
        />
      </div>
    </footer>
  );
}
