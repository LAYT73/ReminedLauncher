import { FunctionAnimation, type SkinViewer } from "skinview3d";
import type { Preset } from "./viewerTypes";

/** Standing idle — breathing, arm sway, weight shift, slow look-around. */
export function createStandingIdle() {
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
export function createHeadIdle() {
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
export function frameBust(viewer: SkinViewer) {
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
  // Pulled back so the name tag above the head stays in frame.
  viewer.zoom = 0.78;
  viewer.resetCameraPose();
  viewer.playerWrapper.rotation.y = 0;
  // Shift the model (and its name tag) down — same as raising the camera,
  // without breaking the orbit target.
  viewer.playerWrapper.position.y = -1;
  // Gentle spin so idle body motion stays readable
  viewer.autoRotate = true;
  viewer.autoRotateSpeed = 0.28;
}

/** Home splash — full body + nametag, ¾ toward screen-left, fixed pose. */
export function frameFullHome(viewer: SkinViewer) {
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

export function frameFull(viewer: SkinViewer, preset: Preset) {
  if (preset === "home") frameFullHome(viewer);
  else frameFullProfile(viewer);
}
