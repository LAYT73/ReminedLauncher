import { RAIL, type Rail } from "@/shared/config/routes";
import { currentPathname } from "@/shared/lib/navigator";
import { parseRoute } from "@/shared/config/routes";
import { reminedVanillaPackId, vanillaPackId } from "@/shared/lib/packIds";
import { getEditionState, useEditionState } from "@/entities/game-version";
import { useActiveReminePack, useSelectedPack, getActiveReminePack, getSelectedPack } from "./selectors";

/** Pack implied by a vanilla rail's version pick (null on other rails). */
function railPack(rail: Rail, vanillaPick: string, rvPick: string): string | null {
  if (rail === RAIL.vanilla && vanillaPick) return vanillaPackId(vanillaPick);
  if (rail === RAIL.reminedVanilla && rvPick) return reminedVanillaPackId(rvPick);
  return null;
}

/** Pack id of the page the user is on (vanilla pick, else active Remined pack). */
export function useRailPackId(rail: Rail): string | null {
  const vanilla = useEditionState("vanilla").pick;
  const rv = useEditionState("remined-vanilla").pick;
  return railPack(rail, vanilla, rv);
}

export function useCurrentPackId(rail: Rail): string | null {
  const railId = useRailPackId(rail);
  const active = useActiveReminePack();
  const selected = useSelectedPack();
  return railId ?? active?.id ?? selected?.id ?? null;
}

/** Imperative variants (read the router location through the navigator bridge). */
export function getRailPackId(): string | null {
  const { rail } = parseRoute(currentPathname());
  return railPack(
    rail,
    getEditionState("vanilla").pick,
    getEditionState("remined-vanilla").pick,
  );
}

export function getCurrentPackId(): string | null {
  return getRailPackId() ?? getActiveReminePack()?.id ?? getSelectedPack()?.id ?? null;
}
