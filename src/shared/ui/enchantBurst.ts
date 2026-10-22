/** Latin A–Z → Standard Galactic glyphs via "Minecraft Enchanting" @font-face. */
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function readAccent(el: HTMLElement): string {
  const styles = getComputedStyle(el);
  return (
    styles.getPropertyValue("--accent-text").trim() ||
    styles.getPropertyValue("--mc-green").trim() ||
    "#6cc349"
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type BurstOpts = {
  /** Glyph count (default 11). */
  count?: number;
  /** Min/max travel distance in px (default 42–98). */
  distance?: [number, number];
  /** Multiplies glyph size (default 1). */
  sizeScale?: number;
  /** Min/max duration in ms (default 620–900). */
  duration?: [number, number];
  /** Mount target; also lifts the layer above page content. Default: .rail / body. */
  host?: HTMLElement;
};

/**
 * One-shot enchant-glyph burst from a rail / pack icon.
 * Appends to `document.body` so sidebar `overflow` cannot clip the fly-out.
 */
export function burstEnchantFrom(el: HTMLElement, opts: BurstOpts = {}): void {
  if (prefersReducedMotion()) return;

  const count =
    opts.count === undefined
      ? 11
      : Math.max(1, Math.min(18, Math.round(opts.count)));
  const [dMin, dMax] = opts.distance ?? [42, 98];
  const [tMin, tMax] = opts.duration ?? [620, 900];
  const sizeScale = opts.sizeScale ?? 1;
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const accent = readAccent(el);

  const layer = document.createElement("div");
  layer.className = "enchant-burst-layer";
  layer.setAttribute("aria-hidden", "true");
  // Mount inside .rail so glyphs sit above the sidebar fill but under icons.
  const host = opts.host ?? el.closest(".rail") ?? document.body;
  if (opts.host) layer.style.zIndex = "60";
  host.appendChild(layer);

  const angleJitter = (Math.PI * 2) / count;
  let remaining = count;

  for (let i = 0; i < count; i++) {
    const angle =
      (i / count) * Math.PI * 2 + (Math.random() - 0.5) * angleJitter * 0.85;
    const dist = dMin + Math.random() * (dMax - dMin);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - (8 + Math.random() * 14);
    const size = (11 + Math.random() * 9) * sizeScale;
    const rot = (Math.random() - 0.5) * 220;
    const dur = tMin + Math.random() * (tMax - tMin);
    const delay = Math.random() * 55;
    const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0]!;

    const root = document.createElement("span");
    root.className = "enchant-burst-glyph";
    root.style.setProperty("--burst-x", `${cx}px`);
    root.style.setProperty("--burst-y", `${cy}px`);
    root.style.setProperty("--burst-dx", `${dx.toFixed(1)}px`);
    root.style.setProperty("--burst-dy", `${dy.toFixed(1)}px`);
    root.style.setProperty("--burst-rot", `${rot.toFixed(1)}deg`);
    root.style.setProperty("--burst-size", `${size.toFixed(1)}px`);
    root.style.setProperty("--burst-accent", accent);
    root.style.animationDuration = `${dur}ms`;
    root.style.animationDelay = `${delay}ms`;

    const glow = document.createElement("span");
    glow.className = "enchant-burst-glow";
    glow.textContent = ch;

    const core = document.createElement("span");
    core.className = "enchant-burst-core";
    core.textContent = ch;

    root.append(glow, core);
    layer.appendChild(root);

    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      root.remove();
      remaining -= 1;
      if (remaining <= 0) layer.remove();
    };
    root.addEventListener("animationend", done, { once: true });
    window.setTimeout(done, dur + delay + 120);
  }
}
