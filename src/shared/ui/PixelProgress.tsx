type Props = {
  value: number;
  label?: string;
  phase?: string;
  /** Number of square cells (default 20). */
  cells?: number;
};

/** Minecraft-style green square pixel progress bar */
export function PixelProgress({ value, label, phase, cells = 20 }: Props) {
  const steps = Math.max(1, Math.floor(cells));
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const filled = Math.round((pct / 100) * steps);

  return (
    <div
      className="pixel-progress"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {label || phase ? (
        <div className="pixel-progress-meta">
          <div className="pixel-progress-top">
            {phase ? (
              <span className="pixel-progress-phase">{phase}</span>
            ) : (
              <span />
            )}
            <span className="pixel-progress-pct">{pct}%</span>
          </div>
          {label ? (
            <span className="pixel-progress-label" title={label}>
              {label}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="pixel-progress-track" aria-hidden>
        {Array.from({ length: steps }, (_, i) => (
          <span
            key={i}
            className={`pixel-progress-cell ${i < filled ? "is-on" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}
