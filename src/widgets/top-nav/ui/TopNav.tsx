import { useT } from "@/shared/i18n";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { NavLink } from "react-router";
import { RAIL_TABS, TAB, TAB_LABEL_KEY, routeFor } from "@/shared/config/routes";
import { transitionClick } from "@/shared/lib/pageTransition";
import { useRoute } from "@/shared/lib/useRoute";
import { useFriendBadgeStore } from "@/entities/friend";
import { useVoiceStatusStore } from "@/entities/voice-room";
import { TopNavTabIcon } from "./TopNavTabIcon";

type Props = {
  /** Game tray + profile chip. */
  trailing: ReactNode;
};

/** Tab strip of the current rail (links) + trailing widgets. */
export function TopNav({ trailing }: Props) {
  const t = useT();
  const { rail, tab: activeTab } = useRoute();
  const voiceInRoom = useVoiceStatusStore((s) => s.inRoom);
  const voiceInvites = useVoiceStatusStore((s) => s.pendingInvites);
  const friendIncoming = useFriendBadgeStore((s) => s.incoming);
  const friendOnline = useFriendBadgeStore((s) => s.online);
  const tabsRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);
  const inkRail = useRef(rail);

  // Sliding underline: glide between tabs of one rail, snap when the rail
  // (and so the whole tab set) changes.
  useLayoutEffect(() => {
    const tabs = tabsRef.current;
    const ink = inkRef.current;
    if (!tabs || !ink) return;
    const place = (animate: boolean) => {
      const active = tabs.querySelector<HTMLElement>(".topnav-tab.active");
      if (!active) {
        ink.style.opacity = "0";
        return;
      }
      ink.classList.toggle("is-snap", !animate);
      ink.style.opacity = "1";
      ink.style.transform = `translateX(${active.offsetLeft}px)`;
      ink.style.width = `${active.offsetWidth}px`;
    };
    place(inkRail.current === rail);
    inkRail.current = rail;
    const ro = new ResizeObserver(() => place(false));
    ro.observe(tabs);
    return () => ro.disconnect();
  }, [rail, activeTab]);

  return (
    <nav className="topnav">
      <div className="topnav-tabs" ref={tabsRef}>
        <span className="topnav-ink" ref={inkRef} aria-hidden />
        {RAIL_TABS[rail].map((tab) => (
          <NavLink
            key={tab}
            to={routeFor(rail, tab)}
            end
            onClick={transitionClick(routeFor(rail, tab))}
            className={`nav-link topnav-tab ${activeTab === tab ? "active" : ""}`}
          >
            <TopNavTabIcon
              id={tab}
              inRoom={tab === TAB.voice && voiceInRoom}
              inviteCount={tab === TAB.voice ? voiceInvites : 0}
              friendIncoming={tab === TAB.friends ? friendIncoming : 0}
              friendOnline={tab === TAB.friends ? friendOnline : 0}
            />
            {t(TAB_LABEL_KEY[tab])}
          </NavLink>
        ))}
      </div>
      {trailing}
    </nav>
  );
}
