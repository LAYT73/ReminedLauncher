/** Parse #rgb / #rrggbb → [r,g,b] 0–255. */
export function parseHex(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) {
    return [
      parseInt(h[0]! + h[0]!, 16),
      parseInt(h[1]! + h[1]!, 16),
      parseInt(h[2]! + h[2]!, 16),
    ];
  }
  if (/^[0-9a-f]{6}$/i.test(h)) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  return null;
}

export function toHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    "#" +
    [clamp(r), clamp(g), clamp(b)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
  );
}

export function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function lighten(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return toHex(...mix(rgb, [255, 255, 255], amount));
}

export function darken(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return toHex(...mix(rgb, [0, 0, 0], amount));
}

export function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export function normalizeHex(raw: string, fallback: string): string {
  const rgb = parseHex(raw);
  if (!rgb) return fallback;
  return toHex(...rgb);
}
