// Lightweight cold-start performance logger.
// Logs to console with [perf] prefix and stores marks on window.__wfPerf for inspection.

declare global {
  interface Window {
    __wfPerf?: Array<{ name: string; t: number; delta: number }>;
    __wfPerfStart?: number;
  }
}

const ORIGIN =
  typeof window !== "undefined"
    ? (window.__wfPerfStart ??= performance.now())
    : 0;

if (typeof window !== "undefined") {
  window.__wfPerf ??= [];
}

export function perfMark(name: string) {
  if (typeof window === "undefined") return;
  const t = performance.now();
  const delta = t - ORIGIN;
  window.__wfPerf!.push({ name, t, delta });
  // eslint-disable-next-line no-console
  console.log(`[perf] ${name} @ ${delta.toFixed(0)}ms`);
}

export function perfTime<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  return fn().finally(() => {
    const dur = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(`[perf] ${name} took ${dur.toFixed(0)}ms`);
    if (typeof window !== "undefined") {
      window.__wfPerf!.push({ name: `${name}:duration`, t: performance.now(), delta: dur });
    }
  });
}
