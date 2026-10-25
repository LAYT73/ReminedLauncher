import { useGameStore } from "@/entities/game";
import { useInstallStore } from "@/entities/install";

/**
 * Install / prepare state of the party pack only. Progress belongs to the party
 * when the running install is for that pack; any other install reports no percent.
 */
export function usePartyInstall(
  packId: string | null,
  installed: boolean,
): { installing: boolean; percent: number | null } {
  const phase = useGameStore((s) => s.phase);
  const lastLaunchedPackId = useGameStore((s) => s.lastLaunchedPackId);
  const installing = useInstallStore((s) => s.installing);
  const installPackId = useInstallStore((s) => s.installPackId);
  const percent = useInstallStore((s) => s.percent);
  if (!packId || installed) return { installing: false, percent: null };
  const installingParty = installing && installPackId === packId;
  // A join-triggered install runs inside the launch flow (phase 'launching', no installing flag).
  const launchingParty = phase === "launching" && lastLaunchedPackId === packId;
  // Launch flow tags its install with the pack id too (beginLaunch), so percent follows it.
  const launchPackTagged = launchingParty && installPackId === packId;
  return {
    installing: installingParty || launchingParty,
    percent: installingParty || launchPackTagged ? percent : null,
  };
}
