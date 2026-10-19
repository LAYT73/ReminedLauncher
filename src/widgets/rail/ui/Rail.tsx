import { NavLink } from "react-router";
import brandLogo from "@/shared/assets/logo.png";
import vanillaLogo from "@/shared/assets/vanilla.png";
import reminedVanillaLogo from "@/shared/assets/remined-vanilla-logo.png";
import { RAIL, routeFor, type Rail as RailId } from "@/shared/config/routes";
import { useActiveReminePack, usePackContent } from "@/entities/pack";

const cx = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(" ");

type ItemProps = {
  rail: RailId;
  title: string;
  base: string;
  /** Extra class while the item shows a bare logo. */
  extra?: string;
  children: React.ReactNode;
};

function RailLink({ rail, title, base, extra, children }: ItemProps) {
  return (
    <NavLink
      to={routeFor(rail)}
      title={title}
      className={({ isActive }) => cx("nav-link", base, extra, isActive && "active")}
    >
      {children}
    </NavLink>
  );
}

const INSTALLATIONS_ICON = "M5 20h14v-2H5v2zm7-18L5.33 9h3.84v4h5.66V9h3.84L12 2z";

/** Left icon rail: home, Remined pack, vanilla editions, installations, settings. */
export function Rail() {
  const pack = useActiveReminePack();
  const logoUrl = usePackContent(pack?.id)?.logo_url;

  return (
    <aside className="rail">
      <RailLink rail={RAIL.home} title="Home" base="rail-home">
        <img className="rail-brand-logo" src={brandLogo} alt="Remined" />
      </RailLink>

      <RailLink
        rail={RAIL.java}
        title={pack?.name ?? "Pack"}
        base="rail-game"
        extra={logoUrl ? "is-bare-logo" : undefined}
      >
        {logoUrl ? (
          <img className="rail-pack-logo" src={logoUrl} alt="" />
        ) : (
          <div className="block" aria-hidden />
        )}
      </RailLink>

      <div className="rail-spacer" />

      <RailLink rail={RAIL.vanilla} title="Vanilla Minecraft" base="rail-vanilla">
        <img className="rail-vanilla-logo" src={vanillaLogo} alt="" />
      </RailLink>

      <RailLink rail={RAIL.reminedVanilla} title="Remined Vanilla" base="rail-vanilla">
        <img className="rail-vanilla-logo" src={reminedVanillaLogo} alt="" />
      </RailLink>

      <RailLink rail={RAIL.installations} title="Installations" base="rail-settings">
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d={INSTALLATIONS_ICON} />
        </svg>
      </RailLink>

      <RailLink rail={RAIL.settings} title="Settings" base="rail-settings">
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.86 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.3.59.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54c.05.22.25.41.48.41h3.84c.23 0 .43-.19.48-.41l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
        </svg>
      </RailLink>
    </aside>
  );
}
