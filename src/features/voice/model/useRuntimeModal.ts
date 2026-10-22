import { useCallback, useState } from "react";
import { t } from "@/shared/i18n";
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
        phase: t("voice.runtime.phase"),
        message: t("voice.runtime.preparing"),
        percent: 4,
        error: null,
      }),
    [],
  );
  const close = useCallback(() => setState(idleVoiceRuntimeModal()), []);

  return { state, setState, begin, close };
}
