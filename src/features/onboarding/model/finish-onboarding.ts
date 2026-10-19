import { bootstrapLauncher } from "@/entities/pack";
import { syncCloudProfile } from "@/entities/profile";
import { cacheOnboardingCompleted, useSessionStore } from "@/entities/session";

/** First-run setup finished: load everything and enter the app. */
export async function finishOnboarding(): Promise<void> {
  cacheOnboardingCompleted(true);
  await bootstrapLauncher();
  const { session, setGate } = useSessionStore.getState();
  if (session) await syncCloudProfile(session);
  setGate("app");
}
