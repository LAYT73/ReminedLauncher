import { useAuthLifecycle } from "@/features/auth";
import { AppGate } from "./providers/AppGate";
import { GameToastHost } from "./providers/GameToastHost";
import { ToastHost } from "./providers/ToastHost";

export default function App() {
  useAuthLifecycle();
  return (
    <>
      <AppGate />
      <ToastHost />
      <GameToastHost />
    </>
  );
}
