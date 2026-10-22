/** Time origin of the app boot (module load ≈ app start). */
const bootStart = performance.now();

/** Milliseconds since the app started booting. */
export function bootElapsed(): number {
  return performance.now() - bootStart;
}
