import type { CSSProperties } from "react";
import { useT } from "@/shared/i18n";
import { RAIL, routeFor } from "@/shared/config/routes";
import { EnchantParticles } from "@/shared/ui/EnchantParticles";
import { PackHero } from "@/shared/ui/PackHero";
import { PageMotion } from "@/shared/ui/PageMotion";
import { PackGallery, useActiveReminePack, usePackContent } from "@/entities/pack";
import { PackPlaytime } from "@/widgets/pack-playtime";

/** Remined (modpack) play page, driven by the catalog content. */
export function JavaPackPage() {
  const t = useT();
  const pack = useActiveReminePack() ?? null;
  const content = usePackContent(pack?.id);
  const viewKey = routeFor(RAIL.java);
  return (
    <div className="pack-stage">
      <EnchantParticles className="pack-enchant" count={22} interactive />
      <PackHero
        image={content?.wallpaper_url}
        kicker={t("pack.page.javaEdition")}
        title="Remined"
      />

      {pack ? (
        <PageMotion viewKey={viewKey}>
          <section className="pack-about">
            <div className="pack-about-head">
              <div
                className={`pack-logo ${
                  content?.logo_url
                    ? "is-bare"
                    : "is-placeholder"
                }`}
                aria-hidden={!content?.logo_url}
              >
                {content?.logo_url ? (
                  <img src={content.logo_url} alt="" />
                ) : (
                  <span className="pack-logo-fallback">
                    {pack.name
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                )}
              </div>
              <div className="pack-about-titles">
                <h2 className="pack-about-title">
                  {pack.name}
                </h2>
                {content?.tagline ? (
                  <p className="pack-about-tagline">
                    {content.tagline}
                  </p>
                ) : null}
                <p className="pack-about-version">
                  {pack.version}
                </p>
                <PackPlaytime
                  packId={pack.id}
                  className="pack-playtime"
                />
              </div>
            </div>

            {content?.blurb ? (
              <p className="pack-about-blurb">
                {content.blurb}
              </p>
            ) : null}

            {content?.highlights?.length ? (
              <ul className="pack-highlights">
                {content.highlights.map((item, i) => (
                  <li key={item} style={{ ["--i"]: i } as CSSProperties}>
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}

            {content?.gallery?.length ? (
              <>
                <h3 className="pack-gallery-heading">
                  {t("pack.page.screenshots")}
                </h3>
                <PackGallery
                  images={content.gallery}
                  altPrefix={pack.name}
                />
              </>
            ) : null}
          </section>
        </PageMotion>
      ) : null}
    </div>
  );
}
