/** Top-level app state machine: boot splash → sign-in → first-run → app. */
export type Gate = "loading" | "auth" | "onboarding" | "app";
