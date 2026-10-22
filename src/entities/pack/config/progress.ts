import { t } from "@/shared/i18n";

const PHASE_KEY = {
  java: "pack.phase.java",
  pack: "pack.phase.pack",
  fabric: "pack.phase.libraries",
  assets: "pack.phase.assets",
  runtime: "pack.phase.runtime",
  done: "pack.phase.done",
} as const;

/** Human label for a `remined-progress` event phase (resolved at call time). */
export function progressPhaseLabel(phase: string): string | undefined {
  return phase in PHASE_KEY
    ? t(PHASE_KEY[phase as keyof typeof PHASE_KEY])
    : undefined;
}
