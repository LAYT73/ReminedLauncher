/** Remember which info-note blocks the user dismissed, so they stay hidden. */

const KEY = "remined.dismissedNotes.v1";

function read(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === true) out[k] = true;
    }
    return out;
  } catch {
    return {};
  }
}

export function isNoteDismissed(id: string): boolean {
  return read()[id] === true;
}

export function dismissNote(id: string): void {
  try {
    const next = read();
    next[id] = true;
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}
