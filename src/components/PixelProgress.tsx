type Props = {
  value: number;
  label?: string;
  phase?: string;
};

/** Minecraft-style green square pixel progress bar */
export function PixelProgress({ value, label, phase }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const cells = 20;
  const filled = Math.round((pct / 100) * cells);

  return (
    <div className="pixel-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      {label || phase ? (
        <div className="pixel-progress-meta">
          {phase ? <span className="pixel-progress-phase">{phase}</span> : null}
          {label ? <span className="pixel-progress-label">{label}</span> : null}
          <span className="pixel-progress-pct">{pct}%</span>
        </div>
      ) : null}
      <div className="pixel-progress-track" aria-hidden>
        {Array.from({ length: cells }, (_, i) => (
          <span
            key={i}
            className={`pixel-progress-cell ${i < filled ? "is-on" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}
