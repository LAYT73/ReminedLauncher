import { useCallback, useState } from "react";
import {
  idleVoiceRuntimeModal,
  type VoiceRuntimeModalState,
} from "../ui/VoiceRuntimeModal";

/** State of the "preparing voice runtime" modal. */
export function useRuntimeModal() {
  const [state, setState] = useState<VoiceRuntimeModalState>(idleVoiceRuntimeModal);

  const begin = useCallback(
    () =>
      setState({
        open: true,
        phase: "Voice",
        message: "Preparing…",
        percent: 4,
        error: null,
      }),
    [],
  );
  const close = useCallback(() => setState(idleVoiceRuntimeModal()), []);

  return { state, setState, begin, close };
}
