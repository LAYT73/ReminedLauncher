import gallery01 from "./assets/gallery/gallery-01.jpg";
import gallery02 from "./assets/gallery/gallery-02.jpg";
import gallery03 from "./assets/gallery/gallery-03.jpg";
import gallery04 from "./assets/gallery/gallery-04.jpg";
import gallery05 from "./assets/gallery/gallery-05.jpg";
import vanillaproLogo from "./assets/packs/vanillapro-logo.png";

export type PackContent = {
  id: string;
  tagline: string;
  blurb: string;
  highlights: string[];
  gallery: string[];
  /** Drop generated logo at src/assets/packs/{id}-logo.png and import here */
  logo?: string;
};

export const PACK_CONTENT: Record<string, PackContent> = {
  vanillapro: {
    id: "vanillapro",
    tagline: "Vanilla+, cinematic shaders, ready for LAN",
    blurb:
      "Fabric 26.2 build for friends: polished survival look, performance mods, and SkinShuffle skins from Remined. Feels like vanilla — just sharper nights, cleaner HUD, and a pack that launches the same for everyone.",
    highlights: [
      "Shaders & atmosphere",
      "QoL survival HUD",
      "Shared skins over LAN",
      "One-click from Remined",
    ],
    gallery: [gallery01, gallery02, gallery03, gallery04, gallery05],
    logo: vanillaproLogo,
  },
};
