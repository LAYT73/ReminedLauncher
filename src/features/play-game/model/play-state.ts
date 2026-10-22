import { t, useLocale } from "@/shared/i18n";
import { RAIL, type Rail } from "@/shared/config/routes";
import { parseRoute } from "@/shared/config/routes";
import { currentPathname } from "@/shared/lib/navigator";
import { reminedVanillaPackId, vanillaPackId } from "@/shared/lib/packIds";
import { useGameStore, type GamePhase } from "@/entities/game";
import { getEditionState, useEditionState } from "@/entities/game-version";
import { useInstallStore } from "@/entities/install";
import {
  getActiveReminePack,
  useActiveReminePack,
  usePackStore,
} from "@/entities/pack";

export type PlayKind = "installing" | "launching" | "running" | "play" | "download";

/** Resolved at call time so the label follows the current locale. */
export function playLabel(kind: PlayKind): string {
  return t(`pack.play.${kind}`);
}

type Snapshot = {
  rail: Rail;
  phase: GamePhase;
  installing: boolean;
  vanillaPick: string;
  vanillaBusy: boolean;
  rvPick: string;
  rvBusy: boolean;
  installedIds: Set<string>;
  activePackId: string | undefined;
};

export type PlayState = {
  kind: PlayKind;
  label: string;
  /** Anything running that blocks starting another action. */
  busy: boolean;
  disabled: boolean;
  /** Selected version/pack of the current rail is installed. */
  ready: boolean;
  vanillaReady: boolean;
  reminedVanillaReady: boolean;
  packReady: boolean;
};

export function computePlayState(s: Snapshot): PlayState {
  const vanillaReady = Boolean(s.vanillaPick && s.installedIds.has(vanillaPackId(s.vanillaPick)));
  const reminedVanillaReady = Boolean(
    s.rvPick && s.installedIds.has(reminedVanillaPackId(s.rvPick)),
  );
  const packReady = Boolean(s.activePackId && s.installedIds.has(s.activePackId));
  const ready =
    s.rail === RAIL.vanilla
      ? vanillaReady
      : s.rail === RAIL.reminedVanilla
        ? reminedVanillaReady
        : packReady;

  const kind: PlayKind = s.installing
    ? "installing"
    : s.phase === "launching"
      ? "launching"
      : s.phase === "running"
        ? "running"
        : ready
          ? "play"
          : "download";
  const busy = s.phase !== "idle" || s.installing || s.vanillaBusy || s.rvBusy;
  const disabled =
    busy ||
    (s.rail === RAIL.vanilla
      ? !s.vanillaPick
      : s.rail === RAIL.reminedVanilla
        ? !s.rvPick
        : !s.activePackId || s.rail !== RAIL.java);

  return {
    kind,
    label: playLabel(kind),
    busy,
    disabled,
    ready,
    vanillaReady,
    reminedVanillaReady,
    packReady,
  };
}

/** Reactive play state for the playbar and pack pages. */
export function usePlayState(rail: Rail): PlayState {
  useLocale(); // re-render (and recompute label) on locale change
  const phase = useGameStore((s) => s.phase);
  const installing = useInstallStore((s) => s.installing);
  const vanilla = useEditionState("vanilla");
  const rv = useEditionState("remined-vanilla");
  const installedIds = usePackStore((s) => s.installedIds);
  const active = useActiveReminePack();
  return computePlayState({
    rail,
    phase,
    installing,
    vanillaPick: vanilla.pick,
    vanillaBusy: vanilla.busy,
    rvPick: rv.pick,
    rvBusy: rv.busy,
    installedIds,
    activePackId: active?.id,
  });
}

/** Imperative play state for actions. */
export function getPlayState(): PlayState {
  const vanilla = getEditionState("vanilla");
  const rv = getEditionState("remined-vanilla");
  return computePlayState({
    rail: parseRoute(currentPathname()).rail,
    phase: useGameStore.getState().phase,
    installing: useInstallStore.getState().installing,
    vanillaPick: vanilla.pick,
    vanillaBusy: vanilla.busy,
    rvPick: rv.pick,
    rvBusy: rv.busy,
    installedIds: usePackStore.getState().installedIds,
    activePackId: getActiveReminePack()?.id,
  });
}
