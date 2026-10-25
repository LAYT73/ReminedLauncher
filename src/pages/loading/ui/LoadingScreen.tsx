import { useEffect, useState } from "react";
import brandLogo from "@/shared/assets/logo.png";
import poster from "@/shared/assets/home-wallpaper-poster.jpg";
import wallpaper from "@/shared/assets/home-wallpaper.mp4";
import { FALLBACK_APP_VERSION } from "@/shared/config/limits";
import { TIMING } from "@/shared/config/timings";
import { useT } from "@/shared/i18n";
import { profileApi } from "@/entities/profile";
import { EnchantDecode } from "./EnchantDecode";

const MESSAGES = [
  "auth.splash.waking",
  "auth.splash.checkingAccount",
  "auth.splash.syncingPacks",
  "auth.splash.almostThere",
] as const;

const GRID = 12;
/** 53 is coprime with 144, so this is a fixed pseudo-random permutation. */
const CELLS = Array.from({ length: GRID * GRID }, (_, i) => {
  const order = (i * 53 + 17) % (GRID * GRID);
  return {
    key: i,
    style: {
      "--d": `${150 + Math.round((order / (GRID * GRID)) * 540)}ms`,
      backgroundPosition: `${((i % GRID) / (GRID - 1)) * 100}% ${
        (Math.floor(i / GRID) / (GRID - 1)) * 100
      }%`,
    } as React.CSSProperties,
  };
});

const reduceMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Boot splash shown while the launcher resolves auth / offline state. */
export function LoadingScreen({ leaving }: { leaving: boolean }) {
  const t = useT();
  const [step, setStep] = useState(-1);
  const [version, setVersion] = useState(FALLBACK_APP_VERSION);
  const [still] = useState(reduceMotion);

  useEffect(() => {
    let alive = true;
    void profileApi.appVersion().then((v) => alive && v && setVersion(v));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let id = 0;
    const start = window.setTimeout(() => {
      setStep(0);
      id = window.setInterval(() => setStep((s) => s + 1), TIMING.bootStatusCycle);
    }, still ? 0 : TIMING.bootStatusStart);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(id);
    };
  }, [still]);

  const message = step < 0 ? "" : t(MESSAGES[step % MESSAGES.length]);

  return (
    <div className={`gate-screen loading-screen${leaving ? " is-leaving" : ""}`}>
      <div className="loading-bg" aria-hidden>
        <video className="loading-video" src={wallpaper} poster={poster} autoPlay muted loop playsInline />
      </div>
      <div className="loading-shade" aria-hidden />
      <div className="loading-grain" aria-hidden />

      <div className="loading-content">
        <div
          className="loading-logo"
          style={{ "--logo": `url(${brandLogo})` } as React.CSSProperties}
          aria-hidden
        >
          {CELLS.map((c) => (
            <span key={c.key} className="loading-cell" style={c.style} />
          ))}
          <span className="loading-sheen">
            <span className="loading-sheen-band" />
          </span>
        </div>

        <div className="loading-bar" aria-hidden>
          <div className="loading-fill" />
          <div className="loading-notches" />
        </div>

        <div className="loading-status">
          {message && <EnchantDecode text={message} animate={!still} />}
          <span className="loading-sr" role="status" aria-live="polite">
            {message}
          </span>
        </div>
      </div>

      <span className="loading-corner loading-version" aria-hidden>
        v{version}
      </span>
      <span className="loading-corner loading-mark" aria-hidden>
        Remined &copy;
      </span>
    </div>
  );
}
