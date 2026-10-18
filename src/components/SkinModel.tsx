import { useEffect, useRef } from "react";
import { FunctionAnimation, NameTagObject, SkinViewer } from "skinview3d";
import {
  CanvasTexture,
  DirectionalLight,
  NearestFilter,
  Sprite,
  SpriteMaterial,
} from "three";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import steveUrl from "../assets/steve.png";
import {
  normalizeSkinModel,
  type SkinModelKind,
} from "../lib/skinModel";

/** Vanilla Mojangles size used by skinview3d nametags. */
const MC_NAMETAG_FONT = "16px Minecraft";

/**
 * Soften silhouette “stairs” (aliasing).
 * skinview3d already runs FXAA; SMAA + mild supersample looks cleaner on blocky skins.
 */
function enableSkinAntiAlias(viewer: SkinViewer): () => void {
  // Render sharper than CSS pixels (capped so retina doesn’t melt the GPU)
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  viewer.pixelRatio = Math.min(dpr * 1.5, 2.5);

  viewer.fxaaPass.enabled = false;
  const pr = viewer.renderer.getPixelRatio();
  const smaa = new SMAAPass(viewer.width * pr, viewer.height * pr);
  viewer.composer.addPass(smaa);

  return () => {
    if (viewer.disposed) return;
    const nextPr = viewer.renderer.getPixelRatio();
    smaa.setSize(viewer.width * nextPr, viewer.height * nextPr);
  };
}

/**
 * Home splash only — form shading on the character (no ground shadow).
 * Profile keeps skinview3d defaults (even light from all sides).
 */
function enableHomeSkinShading(viewer: SkinViewer) {
  viewer.renderer.shadowMap.enabled = false;

  viewer.globalLight.intensity = 0.7;
  viewer.cameraLight.intensity = 0.45;

  const key = new DirectionalLight(0xffffff, 3.55);
  key.position.set(40, 22, 44);
  key.castShadow = false;
  viewer.scene.add(key);

  const fill = new DirectionalLight(0xfff4ea, 0.35);
  fill.position.set(14, 6, -8);
  fill.castShadow = false;
  viewer.scene.add(fill);
}

type Variant = "full" | "bust";

/** Profile = original git framing; home = splash ¾ + nametag framing. */
type Preset = "profile" | "home";

type Props = {
  skinUrl: string | null;
  variant?: Variant;
  className?: string;
  /** Camera / controls preset. Default `profile` (git framing). */
  preset?: Preset;
  /** Clear WebGL clear color — character floats over page art. */
  transparent?: boolean;
  /** Minecraft nametag above the head (home). */
  nameTag?: string | null;
  /** Classic wide (`default`) or slim arms. */
  skinModel?: SkinModelKind | null;
};

/** Standing idle — breathing, arm sway, weight shift, slow look-around. */
function createStandingIdle() {
  const anim = new FunctionAnimation((player, progress) => {
    const t = progress;
    const breath = Math.sin(t * 1.55) * 0.028;
    player.skin.body.rotation.x = breath;

    const armBase = Math.PI * 0.025;
    player.skin.leftArm.rotation.z = Math.cos(t * 1.05) * 0.14 + armBase;
    player.skin.rightArm.rotation.z =
      Math.cos(t * 1.05 + Math.PI) * 0.14 - armBase;
    player.skin.leftArm.rotation.x = Math.sin(t * 0.85) * 0.08 + breath * 0.4;
    player.skin.rightArm.rotation.x =
      Math.sin(t * 0.85 + 0.9) * 0.08 + breath * 0.4;

    player.skin.leftLeg.rotation.z = Math.sin(t * 0.65) * 0.03;
    player.skin.rightLeg.rotation.z = -Math.sin(t * 0.65) * 0.03;
    player.skin.leftLeg.rotation.x = Math.sin(t * 0.65) * 0.02;
    player.skin.rightLeg.rotation.x = -Math.sin(t * 0.65) * 0.02;

    // Uneven look — not a perfect sine loop (profile original)
    player.skin.head.rotation.y =
      Math.sin(t * 0.42) * 0.38 + Math.sin(t * 0.16) * 0.18;
    player.skin.head.rotation.x = Math.sin(t * 0.5) * 0.1 + breath * 0.5;
  });
  anim.speed = 0.85;
  return anim;
}

/** Bust / avatar — only head is visible. */
function createHeadIdle() {
  const anim = new FunctionAnimation((player, progress) => {
    const t = progress;
    player.skin.head.rotation.y =
      Math.sin(t * 0.55) * 0.22 + Math.sin(t * 0.19) * 0.1;
    player.skin.head.rotation.x = Math.sin(t * 0.7) * 0.08;
  });
  anim.speed = 0.7;
  return anim;
}

/**
 * PlayerObject shifts SkinObject by +8.
 * Head mesh center ≈ y 12; chest ≈ y 2. Header bust must target the head.
 */
function frameBust(viewer: SkinViewer) {
  const skin = viewer.playerObject.skin;
  skin.body.visible = false;
  skin.leftArm.visible = false;
  skin.rightArm.visible = false;
  skin.leftLeg.visible = false;
  skin.rightLeg.visible = false;
  skin.head.visible = true;

  viewer.fov = 34;
  viewer.zoom = 3.15;
  // head group at y=8, mesh center +4 → ~12; slight pullback so face fits
  viewer.controls.target.set(0, 12.4, 0);
  viewer.camera.position.set(0, 13, 50);
  viewer.adjustCameraDistance();
  viewer.controls.update();
  viewer.autoRotate = false;
}

/** Original profile framing from git — zoomed in, gentle spin, orbit. */
function frameFullProfile(viewer: SkinViewer) {
  const skin = viewer.playerObject.skin;
  skin.body.visible = true;
  skin.leftArm.visible = true;
  skin.rightArm.visible = true;
  skin.leftLeg.visible = true;
  skin.rightLeg.visible = true;
  skin.head.visible = true;

  viewer.fov = 50;
  viewer.zoom = 0.9;
  viewer.resetCameraPose();
  viewer.playerWrapper.rotation.y = 0;
  // Gentle spin so idle body motion stays readable
  viewer.autoRotate = true;
  viewer.autoRotateSpeed = 0.28;
}

/** Home splash — full body + nametag, ¾ toward screen-left, fixed pose. */
function frameFullHome(viewer: SkinViewer) {
  const skin = viewer.playerObject.skin;
  skin.body.visible = true;
  skin.leftArm.visible = true;
  skin.rightArm.visible = true;
  skin.leftLeg.visible = true;
  skin.rightLeg.visible = true;
  skin.head.visible = true;

  // Body mid ~16, nametag sits above head — keep both in frame
  // Slightly wider FOV so outstretched idle arms stay inside tall fullscreen slots
  viewer.fov = 54;
  viewer.zoom = 0.48;
  viewer.controls.target.set(0, 17, 0);
  // Camera from front-right → subject reads as facing screen-left
  viewer.camera.position.set(20, 17, 48);
  viewer.playerWrapper.rotation.y = 0;
  viewer.adjustCameraDistance();
  viewer.controls.update();

  viewer.autoRotate = false;
}

function frameFull(viewer: SkinViewer, preset: Preset) {
  if (preset === "home") frameFullHome(viewer);
  else frameFullProfile(viewer);
}

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

function applyNameTag(viewer: SkinViewer, name: string | null | undefined) {
  const text = name?.trim();
  if (!text) {
    viewer.nameTag = null;
    return;
  }
  viewer.nameTag = createMcNameTag(text);
}

export function SkinModel({
  skinUrl,
  variant = "full",
  className,
  preset = "profile",
  transparent = false,
  nameTag = null,
  skinModel = "default",
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);
  const canOrbit = variant === "full" && preset === "profile";
  const model = normalizeSkinModel(skinModel);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    host.replaceChildren(canvas);

    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    const source = skinUrl ?? steveUrl;

    const viewer = new SkinViewer({
      canvas,
      width,
      height,
      skin: source,
      model,
      enableControls: canOrbit,
      animation:
        variant === "full" ? createStandingIdle() : createHeadIdle(),
    });

    if (transparent) {
      viewer.background = null;
    }

    if (preset === "home") {
      enableHomeSkinShading(viewer);
    }
    const syncAntiAlias = enableSkinAntiAlias(viewer);

    viewer.controls.enablePan = false;
    viewer.controls.enableZoom = false;
    viewer.controls.enableRotate = canOrbit;
    viewer.controls.enabled = canOrbit;

    if (variant === "bust") {
      frameBust(viewer);
    } else {
      frameFull(viewer, preset);
    }
    applyNameTag(viewer, nameTag);

    viewerRef.current = viewer;

    const ro = new ResizeObserver(() => {
      if (viewer.disposed) return;
      const w = Math.max(host.clientWidth, 1);
      const h = Math.max(host.clientHeight, 1);
      viewer.setSize(w, h);
      syncAntiAlias();
      if (variant === "bust") frameBust(viewer);
      else if (preset === "home") frameFullHome(viewer);
      // profile: keep orbit pose after resize (original behavior)
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      viewer.dispose();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- skin/nameTag/model via other effects
  }, [variant, transparent, preset, canOrbit]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.disposed) return;
    const result = viewer.loadSkin(skinUrl ?? steveUrl, { model });
    void Promise.resolve(result).then(() => {
      if (viewer.disposed) return;
      if (variant === "bust") frameBust(viewer);
      else frameFull(viewer, preset);
    });
  }, [skinUrl, model, variant, preset]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.disposed) return;
    applyNameTag(viewer, nameTag);
  }, [nameTag]);

  return <div ref={hostRef} className={className} />;
}
