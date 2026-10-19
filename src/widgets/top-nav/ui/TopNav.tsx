import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { RAIL_TABS, TAB, TAB_LABEL, routeFor } from "@/shared/config/routes";
import { useRoute } from "@/shared/lib/useRoute";
import { useVoiceStatusStore } from "@/entities/voice-room";
import { TopNavTabIcon } from "./TopNavTabIcon";

type Props = {
  /** Game tray + profile chip. */
  trailing: ReactNode;
};

/** Tab strip of the current rail (links) + trailing widgets. */
export function TopNav({ trailing }: Props) {
  const { rail, tab: activeTab } = useRoute();
  const voiceInRoom = useVoiceStatusStore((s) => s.inRoom);
  const voiceInvites = useVoiceStatusStore((s) => s.pendingInvites);

  return (
    <nav className="topnav">
      <div className="topnav-tabs">
        {RAIL_TABS[rail].map((tab) => (
          <NavLink
            key={tab}
            to={routeFor(rail, tab)}
            end
            className={`nav-link topnav-tab ${activeTab === tab ? "active" : ""}`}
          >
            <TopNavTabIcon
              id={tab}
              inRoom={tab === TAB.voice && voiceInRoom}
              inviteCount={tab === TAB.voice ? voiceInvites : 0}
            />
            {TAB_LABEL[tab]}
          </NavLink>
        ))}
      </div>
      {trailing}
    </nav>
  );
}
