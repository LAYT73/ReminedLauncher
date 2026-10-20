import { GameToast } from "@/shared/ui/GameToast";
import { useGameToastStore } from "@/shared/lib/gameToast";

export function GameToastHost() {
  const { payload, dismiss } = useGameToastStore();
  return <GameToast payload={payload} onDone={dismiss} />;
}
