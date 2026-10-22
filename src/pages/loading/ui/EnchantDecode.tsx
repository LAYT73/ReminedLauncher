import { useEffect, useState } from "react";
import { TIMING } from "@/shared/config/timings";

const LATIN = "abcdefghijklmnopqrstuvwxyz";

/** Stable per-character Latin stand-in so the enchant font always has a glyph. */
function glyphFor(ch: string, i: number): string {
  if (ch === " ") return " ";
  return LATIN[(ch.charCodeAt(0) * 7 + i * 13) % LATIN.length];
}

/**
 * Enchanting-table decode: the line starts as Standard Galactic glyphs and
 * resolves left to right into readable text. Visual only (aria-hidden).
 */
export function EnchantDecode({ text, animate }: { text: string; animate: boolean }) {
  const [n, setN] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate) {
      setN(text.length);
      return;
    }
    setN(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length) window.clearInterval(id);
    }, TIMING.bootDecodeChar);
    return () => window.clearInterval(id);
  }, [text, animate]);

  return (
    <span className="loading-decode" aria-hidden>
      <span className="loading-decode-size">{text}</span>
      <span className="loading-decode-live">
        <span>{text.slice(0, n)}</span>
        <span className="loading-decode-glyphs">
          {Array.from(text.slice(n), (ch, k) => glyphFor(ch, n + k)).join("")}
        </span>
      </span>
    </span>
  );
}
