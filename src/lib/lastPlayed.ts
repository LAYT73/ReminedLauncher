/** Remember last picked/launched version per play rail (vanilla / Remined Vanilla / Java). */

const KEY = "remined.lastPlayed.v1";

export type LastPlayed = {
  vanilla?: string;
  "remined-vanilla"?: string;
  /** Remine pack id (java rail). */
  java?: string;
};

function read(): LastPlayed {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<LastPlayed>;
    return {
      vanilla:
        typeof parsed.vanilla === "string" && parsed.vanilla
          ? parsed.vanilla
          : undefined,
      "remined-vanilla":
        typeof parsed["remined-vanilla"] === "string" &&
        parsed["remined-vanilla"]
          ? parsed["remined-vanilla"]
          : undefined,
      java:
        typeof parsed.java === "string" && parsed.java
          ? parsed.java
          : undefined,
    };
  } catch {
    return {};
  }
}

export function readLastPlayed(): LastPlayed {
  return read();
}

export function writeLastPlayed(patch: Partial<LastPlayed>): void {
  try {
    const next: LastPlayed = { ...read(), ...patch };
    // Drop empty strings
    for (const key of Object.keys(next) as (keyof LastPlayed)[]) {
      if (!next[key]) delete next[key];
    }
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}
