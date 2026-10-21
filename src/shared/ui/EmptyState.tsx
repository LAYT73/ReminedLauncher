import { useEffect, useState } from "react";
import roomsArt from "@/shared/assets/empty/rooms.png";
import friendsArt from "@/shared/assets/empty/friends.png";
import installationsArt from "@/shared/assets/empty/installations.png";

type EmptyStateKind = "rooms" | "friends" | "installations";

type Props = {
  kind: EmptyStateKind;
  title: string;
  description: string;
};

const ART: Record<EmptyStateKind, string> = {
  rooms: roomsArt,
  friends: friendsArt,
  installations: installationsArt,
};

const tintCache = new Map<string, string>();

function parseColor(raw: string): [number, number, number] | null {
  const hex = raw.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return null;
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

/** Grass-green voxels follow the active theme; stone, wood, and torch stay. */
function recolorGrass(data: Uint8ClampedArray, accent: [number, number, number]) {
  const [ar, ag, ab] = accent;
  const accentLum = 0.2126 * ar + 0.7152 * ag + 0.0722 * ab || 1;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 12) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (!(g >= r + 10 && g >= b + 6 && sat > 0.22 && g > 45)) continue;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const scale = Math.min(1.65, lum / accentLum);
    data[i] = Math.min(255, Math.round(ar * scale));
    data[i + 1] = Math.min(255, Math.round(ag * scale));
    data[i + 2] = Math.min(255, Math.round(ab * scale));
  }
}

function useThemeAccent(): [number, number, number] {
  const [accent, setAccent] = useState<[number, number, number]>([74, 156, 49]);
  useEffect(() => {
    const read = () => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--mc-green-mid")
        .trim();
      const next = parseColor(raw);
      if (next) setAccent(next);
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });
    return () => obs.disconnect();
  }, []);
  return accent;
}

function EmptyStateArt({ kind }: { kind: EmptyStateKind }) {
  const src = ART[kind];
  const accent = useThemeAccent();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const key = `${src}|${accent.join(",")}`;
    const hit = tintCache.get(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    let cancel = false;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      recolorGrass(frame.data, accent);
      ctx.putImageData(frame, 0, 0);
      const next = canvas.toDataURL("image/png");
      tintCache.set(key, next);
      if (!cancel) setUrl(next);
    };
    img.src = src;
    return () => {
      cancel = true;
    };
  }, [src, accent]);

  if (!url) return <span className="empty-state-art" aria-hidden />;
  return <img className="empty-state-art" src={url} alt="" />;
}

export function EmptyState({ kind, title, description }: Props) {
  return (
    <div className={`empty-state is-${kind}`} role="status">
      <EmptyStateArt kind={kind} />
      <div className="empty-state-copy">
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
    </div>
  );
}
