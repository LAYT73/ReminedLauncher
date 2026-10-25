import vanillaLogo from "@/shared/assets/vanilla.png";
import vanillaWallpaper from "@/shared/assets/vanilla-wallpaper.jpg";
import { useT } from "@/shared/i18n";
import { RAIL, routeFor } from "@/shared/config/routes";
import { vanillaPackId } from "@/shared/lib/packIds";
import { EnchantParticles } from "@/shared/ui/EnchantParticles";
import { PackHero } from "@/shared/ui/PackHero";
import { PageMotion } from "@/shared/ui/PageMotion";
import { usePlayState } from "@/features/play-game";
import { useEditionState } from "@/entities/game-version";
import { PackPlaytime } from "@/widgets/pack-playtime";

/** "Vanilla" play page: wallpaper hero + about card. */
export function VanillaPage() {
  const t = useT();
  const pick = useEditionState("vanilla").pick;
  const ready = usePlayState(RAIL.vanilla).vanillaReady;
  const viewKey = routeFor(RAIL.vanilla);
  const packId = vanillaPackId(pick);
  return (
    <div className="pack-stage">
      <EnchantParticles className="pack-enchant" count={18} interactive />
      <PackHero
        image={vanillaWallpaper}
        kicker={t("pack.page.javaEdition")}
        title="Vanilla"
      />
      <PageMotion viewKey={viewKey}>
        <section className="pack-about">
          <div className="pack-about-head">
            <div className="pack-logo is-bare" aria-hidden>
              <img src={vanillaLogo} alt="" />
            </div>
            <div className="pack-about-titles">
              <h2 className="pack-about-title">
                Minecraft {pick || "—"}
              </h2>
              <p className="pack-about-version">
                {ready
                  ? pick
                  : pick
                    ? t("pack.page.notInstalled")
                    : "—"}
              </p>
              <PackPlaytime packId={packId} className="pack-playtime" />
              <p
                className="vanilla-skin-badge"
                title={t("pack.page.vanillaBadgeTitle")}
              >
                {t("pack.page.vanillaBadge")}
              </p>
            </div>
          </div>
          <p className="pack-about-blurb">
            {t("pack.page.vanillaBlurb")}
          </p>
        </section>
      </PageMotion>
    </div>
  );
}
