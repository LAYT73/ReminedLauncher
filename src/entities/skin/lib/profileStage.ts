import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";
import type { SkinViewer } from "skinview3d";

type StageColors = {
  bg: string;
  line: string;
};

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

function readStageColors(): StageColors {
  return {
    bg: cssVar("--bg-deep", "#141414"),
    line: cssVar("--mc-green-hi", "#6cc349"),
  };
}

/** Transparent canvas — only grid lines + ticks (theme accent). */
function makeGridTexture(line: string): CanvasTexture {
  const size = 128;
  const cells = 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const empty = document.createElement("canvas");
    return new CanvasTexture(empty);
  }

  ctx.clearRect(0, 0, size, size);

  const cell = size / cells;
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5;
  for (let i = 0; i <= cells; i++) {
    const p = Math.round(i * cell) + 0.5;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  // Intersection ticks
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = line;
  const tick = 5;
  for (let x = 0; x <= cells; x++) {
    for (let y = 0; y <= cells; y++) {
      const px = Math.round(x * cell);
      const py = Math.round(y * cell);
      ctx.fillRect(px - tick, py - 1, tick * 2, 2);
      ctx.fillRect(px - 1, py - tick, 2, tick * 2);
    }
  }
  ctx.globalAlpha = 1;

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Profile skin stage only: theme clear color + large cyberpunk grid floor.
 * Home splash stays untouched (transparent over hero).
 */
export function enableProfileStage(viewer: SkinViewer): () => void {
  const geo = new PlaneGeometry(72, 72);
  const mat = new MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    opacity: 1,
  });
  const floor = new Mesh(geo, mat);
  floor.rotation.x = -Math.PI / 2;
  // Skin is +8 on PlayerObject; leg bottoms sit ~y=-16 in world space.
  floor.position.y = -16;
  floor.name = "remined-profile-floor";
  // Parent to playerWrapper so autoRotate / orbit spin the floor with the skin.
  viewer.playerWrapper.add(floor);

  let tex: CanvasTexture | null = null;

  const apply = () => {
    if (viewer.disposed) return;
    const c = readStageColors();
    viewer.background = c.bg;

    const next = makeGridTexture(c.line);
    if (tex) tex.dispose();
    tex = next;
    mat.map = next;
    mat.needsUpdate = true;
  };

  apply();

  const root = document.documentElement;
  const mo = new MutationObserver(apply);
  mo.observe(root, {
    attributes: true,
    attributeFilter: ["data-theme", "style", "class"],
  });

  return () => {
    mo.disconnect();
    viewer.playerWrapper.remove(floor);
    geo.dispose();
    mat.dispose();
    if (tex) tex.dispose();
    tex = null;
  };
}
