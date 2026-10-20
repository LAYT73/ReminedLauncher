import { useEffect } from "react";
import { useSessionStore } from "@/entities/session";
import {
  FORCE_UPDATE_MODAL,
  useLauncherUpdate,
} from "../model/store";
import { LauncherUpdateModal } from "./LauncherUpdateModal";

/**
 * After the main app gate opens: check for a launcher update (silent) and
 * show the install modal when one is available. FORCE_UPDATE_MODAL previews UI.
 */
export function LauncherUpdateHost() {
  const gate = useSessionStore((s) => s.gate);
  const checkForUpdate = useLauncherUpdate((s) => s.checkForUpdate);
  const openForcePrompt = useLauncherUpdate((s) => s.openForcePrompt);

  useEffect(() => {
    if (gate !== "app") return;
    if (FORCE_UPDATE_MODAL) {
      openForcePrompt();
      return;
    }
    void checkForUpdate({ silent: true });
  }, [gate, checkForUpdate, openForcePrompt]);

  return <LauncherUpdateModal />;
}
