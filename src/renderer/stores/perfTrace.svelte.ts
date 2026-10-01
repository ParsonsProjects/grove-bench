import type { TraceResult } from '../../shared/types.js';

/**
 * The performance trace Settings → Diagnostics records (main/perf-trace.ts).
 * A store rather than component state, so closing Settings mid-recording
 * doesn't lose the result.
 */
class PerfTraceStore {
  state = $state<'idle' | 'recording' | 'saved' | 'error'>('idle');
  /** Date.now() when the current recording started. */
  startedAt = $state(0);
  result = $state<TraceResult | null>(null);
  error = $state<string | null>(null);

  async record(): Promise<void> {
    if (this.state === 'recording') return;
    this.state = 'recording';
    this.startedAt = Date.now();
    this.error = null;
    try {
      this.result = await window.groveBench.recordPerformanceTrace();
      this.state = 'saved';
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.state = 'error';
    }
  }
}

export const perfTraceStore = new PerfTraceStore();
