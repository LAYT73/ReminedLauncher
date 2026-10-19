import type { CSSProperties } from "react";
import { RAIL, routeFor } from "@/shared/config/routes";
import { EnchantParticles } from "@/shared/ui/EnchantParticles";
import { PageMotion } from "@/shared/ui/PageMotion";
import { PackGallery, useActiveReminePack, usePackContent } from "@/entities/pack";
import { PackPlaytime } from "@/widgets/pack-playtime";

/** Remined (modpack) play page, driven by the catalog content. */
export function JavaPackPage() {
  const pack = useActiveReminePack() ?? null;
  const content = usePackContent(pack?.id);
  const viewKey = routeFor(RAIL.java);
  return (
    <div className="pack-stage">
      <EnchantParticles className="pack-enchant" count={22} />
      <header
        className={`hero${content?.wallpaper_url ? " has-art" : ""}`}
        style={
          content?.wallpaper_url
            ? ({
                ["--hero-image"]: `url("${content.wallpaper_url}")`,
              } as CSSProperties)
            : undefined
        }
      >
        <p className="hero-kicker">Java Edition</p>
        <h1 className="hero-title">Remined</h1>
      </header>

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
                {content.highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}

            {content?.gallery?.length ? (
              <>
                <h3 className="pack-gallery-heading">
                  Screenshots
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
