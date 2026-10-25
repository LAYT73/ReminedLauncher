import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { call } from "@/shared/api/invoke";
import { netLog } from "@/shared/api/netLog";
import { CMD } from "@/shared/config/commands";
import { EVENT } from "@/shared/config/events";
import { RAIL, routeFor, type Rail } from "@/shared/config/routes";
import { TIMING } from "@/shared/config/timings";
import { parseDeepLink } from "@/shared/lib/deepLink";
import { usePartyStore } from "@/entities/voice-room";
import { navigateTo } from "@/shared/lib/navigator";
import {
  isReminedVanillaPackId,
  isVanillaPackId,
  versionFromPackId,
} from "@/shared/lib/packIds";
import { useVersionStore, type Edition } from "@/entities/game-version";
import { usePackStore } from "@/entities/pack";
import { useProfileStore } from "@/entities/profile";

const EDITION_RAIL: Record<Edition, Rail> = {
  vanilla: RAIL.vanilla,
  "remined-vanilla": RAIL.reminedVanilla,
};

function openDeepLink(raw: string): void {
  const link = parseDeepLink(raw);
  if (!link) {
    void netLog("ui", "deep link ignored: unsupported URL");
    return;
  }
  if (link.kind === "join") {
    // Joining by code has no paste UI to prefill yet; see the report for the open question.
    void netLog("ui", "deep link join received: join-by-code flow not wired");
    return;
  }

  if (link.kind === "party") {
    // The voice feature joins (or focuses) the party: it owns the live session.
    // Asked first: a link should not join a party without the player's confirmation.
    usePartyStore.getState().request({ kind: "join", roomId: link.roomId, confirm: true });
    return;
  }

  const { packId } = link;
  if (isVanillaPackId(packId) || isReminedVanillaPackId(packId)) {
    const edition: Edition = isVanillaPackId(packId) ? "vanilla" : "remined-vanilla";
    useVersionStore.getState().patch(edition, { pick: versionFromPackId(packId) });
    navigateTo(routeFor(EDITION_RAIL[edition]));
    return;
  }
  const { packs, catalog } = usePackStore.getState();
  if (packs.some((p) => p.id === packId)) {
    clearPendingPack();
    selectCatalogPack(packId);
    return;
  }
  // Cold start: the catalog (or its entry in the pack list) has not arrived yet.
  if (catalog.length === 0 || catalog.some((c) => c.id === packId)) {
    waitForCatalogPack(packId);
    return;
  }
  void netLog("ui", "deep link pack ignored: unknown pack id");
}

/** A catalog pack link received before the catalog loaded. */
let pendingPack: {
  packId: string;
  timer: ReturnType<typeof setTimeout>;
  unsubscribe: () => void;
} | null = null;

function clearPendingPack(): void {
  if (!pendingPack) return;
  clearTimeout(pendingPack.timer);
  pendingPack.unsubscribe();
  pendingPack = null;
}

/** Make a catalog pack the selected one, then show the Java rail. */
function selectCatalogPack(packId: string): void {
  const { profile, persist } = useProfileStore.getState();
  void persist({ ...profile, selected_pack: packId }).catch(() => undefined);
  navigateTo(routeFor(RAIL.java));
}

/** Wait for `packId` to appear in the pack list, then select it (dropped after a timeout). */
function waitForCatalogPack(packId: string): void {
  clearPendingPack();
  const unsubscribe = usePackStore.subscribe((state) => {
    if (!pendingPack || !state.packs.some((p) => p.id === packId)) return;
    clearPendingPack();
    selectCatalogPack(packId);
  });
  const timer = setTimeout(() => {
    clearPendingPack();
    void netLog("ui", "deep link pack dropped: catalog did not load in time");
  }, TIMING.deepLinkPackWait);
  pendingPack = { packId, timer, unsubscribe };
}

/**
 * Opens `remined://` links. Links that arrive before this hook subscribes
 * (cold start) are queued in Rust and replayed once after the listener is up.
 */
export function useDeepLinkEffects(): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<string>(EVENT.deepLink, (ev) => openDeepLink(ev.payload))
      .then(async (fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
        const queued = await call<string[]>(CMD.drainDeepLinks).catch(() => []);
        queued.forEach(openDeepLink);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
      clearPendingPack();
      void call(CMD.releaseDeepLinks).catch(() => undefined);
    };
  }, []);
}
