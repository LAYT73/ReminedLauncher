import type { CSSProperties } from "react";
import reminedVanillaLogo from "@/shared/assets/remined-vanilla-logo.png";
import reminedVanillaBanner from "@/shared/assets/remined-vanilla-banner.jpg";
import { RAIL, routeFor } from "@/shared/config/routes";
import { reminedVanillaPackId } from "@/shared/lib/packIds";
import { EnchantParticles } from "@/shared/ui/EnchantParticles";
import { PageMotion } from "@/shared/ui/PageMotion";
import { usePlayState } from "@/features/play-game";
import { useEditionState } from "@/entities/game-version";
import { PackPlaytime } from "@/widgets/pack-playtime";

/** "Remined Vanilla" play page. */
export function ReminedVanillaPage() {
  const pick = useEditionState("remined-vanilla").pick;
  const ready = usePlayState(RAIL.reminedVanilla).reminedVanillaReady;
  const viewKey = routeFor(RAIL.reminedVanilla);
  const packId = reminedVanillaPackId(pick);
  return (
    <div className="pack-stage">
      <EnchantParticles className="pack-enchant" count={18} />
      <header
        className="hero has-art"
        style={
          {
            ["--hero-image"]: `url("${reminedVanillaBanner}")`,
          } as CSSProperties
        }
      >
        <p className="hero-kicker">Fabric · Skins</p>
        <h1 className="hero-title">Remined Vanilla</h1>
      </header>
      <PageMotion viewKey={viewKey}>
        <section className="pack-about">
          <div className="pack-about-head">
            <div className="pack-logo is-bare" aria-hidden>
              <img src={reminedVanillaLogo} alt="" />
            </div>
            <div className="pack-about-titles">
              <h2 className="pack-about-title">
                Minecraft {pick || "—"}
              </h2>
              <p className="pack-about-version">
                {ready
                  ? pick
                  : pick
                    ? "Not installed"
                    : "—"}
              </p>
              <PackPlaytime packId={packId} className="pack-playtime" />
              <p
                className="vanilla-skin-badge is-ok"
                title="Installs Fabric with SkinShuffle + CustomSkinLoader so your Remined skin works for you and friends, plus Sodium/Iris and other performance mods when available for that version."
              >
                Skins + Sodium/Iris · friends can see your skin
              </p>
            </div>
          </div>
          <p className="pack-about-blurb">
            Clean Minecraft on Fabric, limited to versions where
            Remined skins work. Download installs skins, LAN helper,
            and the Remined opti stack for that branch (1.20-style or
            26.x-style: Sodium/Iris, Lithium, Culling, C2ME, and more)
            plus Resourcify when Modrinth has a build.
          </p>
        </section>
      </PageMotion>
    </div>
  );
}
