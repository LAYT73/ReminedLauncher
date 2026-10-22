import { useEffect, useState } from "react";
import { Outlet } from "react-router";
import { isPackRail, type Rail as RailId } from "@/shared/config/routes";
import { TIMING } from "@/shared/config/timings";
import { PageTransitionOverlay } from "@/shared/ui/PageTransitionOverlay";
import { useRail } from "@/shared/lib/useRoute";
import { GameTray } from "@/widgets/game-tray";
import { HomeVideoLayer } from "@/widgets/home-video";
import { Playbar } from "@/widgets/playbar";
import { ProfileChip } from "@/widgets/profile-chip";
import { Rail } from "@/widgets/rail";
import { TopNav } from "@/widgets/top-nav";
import { VoiceHost, VoiceSlot } from "@/widgets/voice-host";
import { useShellEffects } from "../providers/useShellEffects";

type BarPhase = "enter" | "idle" | "leave";

/** Keeps the playbar mounted through its slide-out, pinned to the last pack rail. */
function usePlaybarPresence(rail: RailId): { barRail: RailId | null; phase: BarPhase } {
  const show = isPackRail(rail);
  const [barRail, setBarRail] = useState<RailId | null>(show ? rail : null);
  const [phase, setPhase] = useState<BarPhase>("enter");

  useEffect(() => {
    if (show) {
      // Fresh mount or caught mid slide-out: slide (back) in.
      if (!barRail || phase === "leave") setPhase("enter");
      setBarRail(rail);
      return;
    }
    if (!barRail) return;
    setPhase("leave");
    const t = window.setTimeout(() => setBarRail(null), TIMING.playbarSlide);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to rail only
  }, [show, rail]);

  useEffect(() => {
    if (phase !== "enter" || !barRail) return;
    const t = window.setTimeout(() => setPhase("idle"), TIMING.playbarSlide);
    return () => window.clearTimeout(t);
  }, [phase, barRail]);

  return { barRail, phase };
}

/** Chrome around every route: rail, top nav, content outlet and the playbar. */
export function ShellLayout() {
  useShellEffects();
  const rail = useRail();
  const { barRail, phase } = usePlaybarPresence(rail);

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
        <PageTransitionOverlay />
        {barRail ? (
          <div className={`playbar-slot is-${phase}`}>
            <div className="playbar-slot-inner">
              <Playbar rail={barRail} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
