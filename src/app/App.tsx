import { useAuthLifecycle } from "@/features/auth";
import { AppGate } from "./providers/AppGate";
import { ToastHost } from "./providers/ToastHost";

export default function App() {
  useAuthLifecycle();
  return (
    <>
      <AppGate />
      <ToastHost />
    </>
  );
}
