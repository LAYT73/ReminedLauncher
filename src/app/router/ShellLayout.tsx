import { Outlet } from "react-router";
import { isPackRail } from "@/shared/config/routes";
import { useRail } from "@/shared/lib/useRoute";
import { GameTray } from "@/widgets/game-tray";
import { HomeVideoLayer } from "@/widgets/home-video";
import { Playbar } from "@/widgets/playbar";
import { ProfileChip } from "@/widgets/profile-chip";
import { Rail } from "@/widgets/rail";
import { TopNav } from "@/widgets/top-nav";
import { VoiceHost, VoiceSlot } from "@/widgets/voice-host";
import { useShellEffects } from "../providers/useShellEffects";

/** Chrome around every route: rail, top nav, content outlet and the playbar. */
export function ShellLayout() {
  useShellEffects();
  const rail = useRail();

  return (
    <div className="shell">
      <Rail />
      <div className="stage">
        <HomeVideoLayer />
        <VoiceHost />
        <TopNav
          trailing={
            <>
              <GameTray />
              <ProfileChip />
            </>
          }
        />
        <div className="content">
          <Outlet />
          <VoiceSlot />
        </div>
        {isPackRail(rail) ? <Playbar /> : null}
      </div>
    </div>
  );
}
