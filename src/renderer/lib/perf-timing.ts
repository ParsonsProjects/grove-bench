/**
 * Step timings in the window: each step shows as a named span in DevTools'
 * Performance panel (and in a saved trace), and the whole run goes to the
 * performance log in main (main/perf-steps.ts).
 */
import type { TimingReport } from '../../shared/types.js';

export interface StepTiming {
  /** The step `name` just ended. */
  step(name: string): void;
  /** All steps are done; send them. */
  done(detail?: string): void;
}

function measure(name: string, start: number, end: number): void {
  try {
    performance.measure(name, { start, end });
  } catch { /* a browser without measure options: DevTools just misses it */ }
}

export function timeSteps(
  label: string,
  sessionId?: string,
  report: (r: TimingReport) => void = (r) => window.groveBench.reportTiming(r),
): StepTiming {
  const start = performance.now();
  let last = start;
  const steps: TimingReport['steps'] = [];
  return {
    step(name) {
      const t = performance.now();
      measure(`grove ${label}: ${name}`, last, t);
      steps.push({ name, ms: t - last });
      last = t;
    },
    done(detail) {
      measure(`grove ${label}`, start, last);
      report({ label, steps, ...(sessionId ? { sessionId } : {}), ...(detail ? { detail } : {}) });
    },
  };
}

/** Resolves once the next frame has been drawn. */
export function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}
