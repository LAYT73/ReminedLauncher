import { useT } from "@/shared/i18n";
import type { MouseEvent } from "react";
import { NavLink } from "react-router";
import brandLogo from "@/shared/assets/logo.png";
import vanillaLogo from "@/shared/assets/vanilla.png";
import reminedVanillaLogo from "@/shared/assets/remined-vanilla-logo.png";
import { RAIL, routeFor, type Rail as RailId } from "@/shared/config/routes";
import { useActiveReminePack, usePackContent } from "@/entities/pack";
import { transitionClick } from "@/shared/lib/pageTransition";
import { burstEnchantFrom } from "@/shared/ui/enchantBurst";
import { PixelDownloadIcon, PixelGearIcon } from "@/shared/ui/PixelIcons";

const cx = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(" ");

type ItemProps = {
  rail: RailId;
  title: string;
  base: string;
  /** Extra class while the item shows a bare logo. */
  extra?: string;
  /** Enchant glyph burst on click (pack / edition icons). */
  burst?: boolean;
  children: React.ReactNode;
};

function RailLink({ rail, title, base, extra, burst, children }: ItemProps) {
  const to = routeFor(rail);
  const go = transitionClick(to);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (burst) burstEnchantFrom(e.currentTarget);
    go(e);
  };

  return (
    <NavLink
      to={to}
      title={title}
      onClick={onClick}
      className={({ isActive }) => cx("nav-link", base, extra, isActive && "active")}
    >
      {children}
    </NavLink>
  );
}


/** Left icon rail: home, Remined pack, vanilla editions, installations, settings. */
export function Rail() {
  const t = useT();
  const pack = useActiveReminePack();
  const logoUrl = usePackContent(pack?.id)?.logo_url;

  return (
    <aside className="rail">
      <RailLink rail={RAIL.home} title={t("shell.rail.home")} base="rail-home" burst>
        <img className="rail-brand-logo" src={brandLogo} alt="Remined" />
      </RailLink>

      <RailLink
        rail={RAIL.java}
        title={pack?.name ?? t("shell.rail.pack")}
        base="rail-game"
        extra={logoUrl ? "is-bare-logo" : undefined}
        burst
      >
        {logoUrl ? (
          <img className="rail-pack-logo" src={logoUrl} alt="" />
        ) : (
          <div className="block" aria-hidden />
        )}
      </RailLink>

      <div className="rail-spacer" />

      <RailLink rail={RAIL.vanilla} title={t("shell.rail.vanilla")} base="rail-vanilla" burst>
        <img className="rail-vanilla-logo" src={vanillaLogo} alt="" />
      </RailLink>

      <RailLink
        rail={RAIL.reminedVanilla}
        title={t("shell.rail.reminedVanilla")}
        base="rail-vanilla"
        burst
      >
        <img className="rail-vanilla-logo" src={reminedVanillaLogo} alt="" />
      </RailLink>

      <RailLink rail={RAIL.installations} title={t("shell.rail.installations")} base="rail-settings">
        <PixelDownloadIcon />
      </RailLink>

      <RailLink rail={RAIL.settings} title={t("shell.rail.settings")} base="rail-settings">
        <PixelGearIcon />
      </RailLink>
    </aside>
  );
}
