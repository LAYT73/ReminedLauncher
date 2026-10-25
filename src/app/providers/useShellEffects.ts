import { useGameWatch } from "@/features/game-watch";
import { useLanHosting } from "@/features/lan-hosting";
import { useAutoLoadVersions, useSyncJavaSelection } from "@/features/play-game";
import {
  useFriendPlayToasts,
  usePresenceHeartbeat,
} from "@/features/presence";
import { useProgressListener, useTransientStatus } from "@/entities/install";
import { useDeepLinkEffects } from "./useDeepLinkEffects";
import { useGameBridgeEffects } from "./useGameBridgeEffects";

/** Background behaviours that live as long as the signed-in app shell. */
export function useShellEffects(): void {
  useGameWatch();
  useProgressListener();
  useTransientStatus();
  useLanHosting();
  usePresenceHeartbeat();
  useFriendPlayToasts();
  useGameBridgeEffects();
  useDeepLinkEffects();
  useAutoLoadVersions();
  useSyncJavaSelection();
}
