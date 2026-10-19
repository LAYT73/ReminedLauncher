import { AuthScreen } from "@/features/auth";
import { OnboardingScreen } from "@/features/onboarding";
import { LoadingScreen } from "@/pages/loading";
import { useSessionStore } from "@/entities/session";
import { AppRouter } from "../router/AppRouter";

/** boot splash → sign-in → first-run setup → routed app. */
export function AppGate() {
  const gate = useSessionStore((s) => s.gate);
  const bootLeaving = useSessionStore((s) => s.bootLeaving);

  switch (gate) {
    case "loading":
      return <LoadingScreen leaving={bootLeaving} />;
    case "auth":
      return <AuthScreen />;
    case "onboarding":
      return <OnboardingScreen />;
    case "app":
      return <AppRouter />;
  }
}
