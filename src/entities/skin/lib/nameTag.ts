import { NameTagObject, type SkinViewer } from "skinview3d";
import { CanvasTexture, NearestFilter, Sprite, SpriteMaterial } from "three";

/** Vanilla Mojangles size used by skinview3d nametags. */
const MC_NAMETAG_FONT = "16px Minecraft";

/**
 * Paint a Java Edition–style nametag (Mojangles + 1px SE shadow + 25% black plate).
 * @see https://minecraft.wiki/w/Font — shadow is glyph RGB/4, offset 1px
 */
function paintMcNameTag(
  material: SpriteMaterial,
  sprite: Sprite,
  text: string,
) {
  const margin = [5, 10, 5, 10] as const; // top, right, bottom, left
  const height = 4;
  const canvas = document.createElement("canvas");
  let ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.font = MC_NAMETAG_FONT;
  const metrics = ctx.measureText(text);
  // +1px room for the vanilla drop shadow
  canvas.width =
    margin[3] +
    metrics.actualBoundingBoxLeft +
    metrics.actualBoundingBoxRight +
    margin[1] +
    1;
  canvas.height =
    margin[0] +
    metrics.actualBoundingBoxAscent +
    metrics.actualBoundingBoxDescent +
    margin[2] +
    1;

  ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.font = MC_NAMETAG_FONT;
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const x = margin[3] + metrics.actualBoundingBoxLeft;
  const y = margin[0] + metrics.actualBoundingBoxAscent;
  // White → shadow #3F3F3F (255/4)
  ctx.fillStyle = "#3F3F3F";
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(text, x, y);

  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  material.map?.dispose();
  material.map = texture;
  material.needsUpdate = true;

  const ratio = canvas.width / canvas.height;
  sprite.scale.set(height * ratio, height, 1);
}

function createMcNameTag(text: string): NameTagObject {
  const material = new SpriteMaterial({
    transparent: true,
    alphaTest: 1e-5,
  });
  const sprite = new Sprite(material);
  paintMcNameTag(material, sprite, text);

  if (!document.fonts.check(MC_NAMETAG_FONT, text)) {
    void document.fonts.load(MC_NAMETAG_FONT, text).then(() => {
      paintMcNameTag(material, sprite, text);
    });
  }

  // Runtime only needs a Sprite; SkinViewer types it as NameTagObject.
  return sprite as unknown as NameTagObject;
}

export function applyNameTag(viewer: SkinViewer, name: string | null | undefined) {
  const text = name?.trim();
  if (!text) {
    viewer.nameTag = null;
    return;
  }
  viewer.nameTag = createMcNameTag(text);
}
