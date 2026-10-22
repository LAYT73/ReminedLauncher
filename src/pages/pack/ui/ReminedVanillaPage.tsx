import type { CSSProperties } from "react";
import reminedVanillaLogo from "@/shared/assets/remined-vanilla-logo.png";
import reminedVanillaBanner from "@/shared/assets/remined-vanilla-banner.jpg";
import { useT } from "@/shared/i18n";
import { RAIL, routeFor } from "@/shared/config/routes";
import { reminedVanillaPackId } from "@/shared/lib/packIds";
import { EnchantParticles } from "@/shared/ui/EnchantParticles";
import { PageMotion } from "@/shared/ui/PageMotion";
import { usePlayState } from "@/features/play-game";
import { useEditionState } from "@/entities/game-version";
import { PackPlaytime } from "@/widgets/pack-playtime";

/** "Remined Vanilla" play page. */
export function ReminedVanillaPage() {
  const t = useT();
  const pick = useEditionState("remined-vanilla").pick;
  const ready = usePlayState(RAIL.reminedVanilla).reminedVanillaReady;
  const viewKey = routeFor(RAIL.reminedVanilla);
  const packId = reminedVanillaPackId(pick);
  return (
    <div className="pack-stage">
      <EnchantParticles className="pack-enchant" count={18} interactive />
      <header
        className="hero has-art"
        style={
          {
            ["--hero-image"]: `url("${reminedVanillaBanner}")`,
          } as CSSProperties
        }
      >
        <p className="hero-kicker">{t("pack.page.fabricSkins")}</p>
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
                    ? t("pack.page.notInstalled")
                    : "—"}
              </p>
              <PackPlaytime packId={packId} className="pack-playtime" />
              <p
                className="vanilla-skin-badge is-ok"
                title={t("pack.page.reminedBadgeTitle")}
              >
                {t("pack.page.reminedBadge")}
              </p>
            </div>
          </div>
          <p className="pack-about-blurb">
            {t("pack.page.reminedBlurb")}
          </p>
        </section>
      </PageMotion>
    </div>
  );
}
