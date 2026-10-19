import { PixelProgress } from "@/shared/ui/PixelProgress";
import { PixelCrossIcon } from "@/shared/ui/PixelIcons";
import { PlayButton } from "@/shared/ui/PlayButton";
import { useRail } from "@/shared/lib/useRoute";
import { cancelCurrentInstall, launch, usePlayState } from "@/features/play-game";
import { useGameStore } from "@/entities/game";
import { useInstallStore, useShowProgress } from "@/entities/install";
import { PROGRESS_PHASE } from "@/entities/pack";
import { PlaybarSelect } from "./PlaybarSelect";

/** Bottom bar: pack/version picker, status or progress, cancel + Play. */
export function Playbar() {
  const rail = useRail();
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
            phase={PROGRESS_PHASE[phase] ?? (phase || (launching ? "Launch" : ""))}
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
            title="Cancel"
            aria-label="Cancel install"
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
