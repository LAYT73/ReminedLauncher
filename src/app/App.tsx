import { useAuthLifecycle } from "@/features/auth";
import { LauncherUpdateHost } from "@/features/launcher-update";
import { AppGate } from "./providers/AppGate";
import { ToastHost } from "./providers/ToastHost";

export default function App() {
  useAuthLifecycle();
  return (
    <>
      <AppGate />
      <ToastHost />
      <LauncherUpdateHost />
    </>
  );
}
