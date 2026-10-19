/** True when an invoke() error is the backend reporting a user cancel. */
export function isCancelledError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /cancelled/i.test(msg);
}
