/**
 * Reports frames the window took over FREEZE_MS on to main's freeze log
 * (main/freeze-log.ts), with the scripts that ran longest in them.
 *
 * Long animation frames count style and layout as well as script, which is
 * most of what a big render costs; long tasks leave that out, so they are
 * only the fallback where frames can't be timed.
 */
import type { FreezeReport } from '../../shared/types.js';

export const FREEZE_MS = 100;

/** The parts of a long-animation-frame entry this reads. */
interface FrameEntry extends PerformanceEntry {
  styleAndLayoutStart?: number;
  scripts?: ScriptEntry[];
}

interface ScriptEntry {
  duration: number;
  invoker?: string;
  sourceURL?: string;
  sourceFunctionName?: string;
  sourceCharPosition?: number;
  forcedStyleAndLayoutDuration?: number;
}

/** "invoker fn (file:pos) 120 ms, forced layout 30 ms" */
function describeScript(s: ScriptEntry): string {
  const file = s.sourceURL ? s.sourceURL.slice(s.sourceURL.lastIndexOf('/') + 1) : '';
  const where = file ? ` (${file}${s.sourceCharPosition !== undefined && s.sourceCharPosition >= 0 ? `:${s.sourceCharPosition}` : ''})` : '';
  const fn = s.sourceFunctionName ? ` ${s.sourceFunctionName}` : '';
  const forced = s.forcedStyleAndLayoutDuration && s.forcedStyleAndLayoutDuration >= 1
    ? `, forced layout ${Math.round(s.forcedStyleAndLayoutDuration)} ms`
    : '';
  return `${s.invoker || 'script'}${fn}${where} ${Math.round(s.duration)} ms${forced}`;
}

export function describeEntry(entry: PerformanceEntry): FreezeReport {
  if (entry.entryType !== 'long-animation-frame') {
    return { kind: 'task', durationMs: entry.duration };
  }
  const frame = entry as FrameEntry;
  const end = frame.startTime + frame.duration;
  const renderMs = frame.styleAndLayoutStart && frame.styleAndLayoutStart > 0
    ? Math.max(0, end - frame.styleAndLayoutStart)
    : undefined;
  const scripts = [...(frame.scripts ?? [])]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 3)
    .map(describeScript);
  return {
    kind: 'frame',
    durationMs: frame.duration,
    ...(renderMs !== undefined ? { renderMs } : {}),
    ...(scripts.length > 0 ? { scripts } : {}),
  };
}

/** Watch for slow frames and pass each to `report`. Returns a function that
 *  stops watching. Does nothing where the browser can't time either. */
export function installFreezeWatch(report: (r: FreezeReport) => void): () => void {
  if (typeof PerformanceObserver === 'undefined') return () => {};
  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  const type = supported.includes('long-animation-frame') ? 'long-animation-frame'
    : supported.includes('longtask') ? 'longtask'
      : null;
  if (!type) return () => {};
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration >= FREEZE_MS) report(describeEntry(entry));
    }
  });
  observer.observe({ type });
  return () => observer.disconnect();
}
