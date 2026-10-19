import brandLogo from "@/shared/assets/logo.png";

/** Boot splash shown while the launcher resolves auth / offline state. */
export function LoadingScreen({ leaving }: { leaving: boolean }) {
  return (
    <div
      className={`gate-screen loading-screen${leaving ? " is-leaving" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="loading-panel">
        <img className="loading-logo" src={brandLogo} alt="" />
        <p className="loading-kicker">Remined Launcher</p>
        <h1 className="loading-title">Loading</h1>
        <div className="loading-bar" aria-hidden>
          {Array.from({ length: 14 }, (_, i) => (
            <span
              key={i}
              className="loading-bar-cell"
              style={{ animationDelay: `${i * 0.08}s` }}
            />
          ))}
        </div>
        <p className="loading-hint">Building terrain…</p>
      </div>
    </div>
  );
}
