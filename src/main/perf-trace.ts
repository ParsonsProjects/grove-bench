/**
 * Performance traces: record what every part of the app does for a few
 * seconds (Chromium's tracing, through Electron's contentTracing) and save
 * it as a file to open in Perfetto (ui.perfetto.dev) or chrome://tracing.
 * Settings → Diagnostics starts one; the user then does the slow thing.
 *
 * Traces go to logs/traces and only the newest few are kept. They stay on
 * this computer; they hold timings, function names, file paths and page
 * addresses, not conversation text.
 */
import { contentTracing, type TraceConfig } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PERFORMANCE_TRACE_SECONDS, type TraceResult } from '../shared/types.js';
import { getLogDir } from './logger.js';
import { perfLine } from './perf-log.js';

export const TRACE_SECONDS = PERFORMANCE_TRACE_SECONDS;
/** Older traces are deleted beyond this many. */
const KEEP_TRACES = 5;

/** What DevTools' Performance panel records (script, style, layout, paint,
 *  input, sampled JS stacks), plus IPC, scheduling and Electron's own. */
export const TRACE_CONFIG: TraceConfig = {
  included_categories: [
    'toplevel', 'toplevel.flow',
    'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame',
    'v8', 'v8.execute', 'disabled-by-default-v8.cpu_profiler',
    'blink', 'blink.user_timing', 'loading', 'input', 'latencyInfo', 'benchmark',
    'cc', 'gpu', 'viz', 'ipc', 'mojom', 'scheduler',
    'electron', 'node',
  ],
  recording_mode: 'record-until-full',
  trace_buffer_size_in_kb: 200 * 1024,
};

export interface TraceDeps {
  tracing: Pick<typeof contentTracing, 'startRecording' | 'stopRecording'>;
  wait: (ms: number) => Promise<void>;
  dir: () => string;
  /** The time the file is named after. */
  date: () => Date;
  write: (line: string) => void;
}

const defaultDeps: TraceDeps = {
  tracing: contentTracing,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  dir: () => path.join(getLogDir(), 'traces'),
  date: () => new Date(),
  write: (line) => perfLine('trace', line),
};

let recording: Promise<TraceResult> | null = null;
let lastTrace: string | null = null;

/** The newest trace saved since launch, if any. */
export function lastTracePath(): string | null {
  return lastTrace;
}

/** Keep `saved` and the newest `keep - 1` other traces, deleting the rest.
 *  Names sort by the time they were saved at; `saved` is kept whatever its
 *  name, in case the clock was moved back since the others. */
async function prune(dir: string, keep: number, saved: string): Promise<void> {
  const others = (await fs.readdir(dir)).filter((n) => /^trace-.*\.json$/.test(n) && n !== saved).sort();
  const old = others.slice(0, Math.max(0, others.length - (keep - 1)));
  await Promise.all(old.map((n) => fs.rm(path.join(dir, n), { force: true })));
}

/**
 * Record for `seconds`, then save the trace. Only one runs at a time: asking
 * again while one records gets that one's result.
 */
export function recordTrace(seconds = TRACE_SECONDS, deps: TraceDeps = defaultDeps): Promise<TraceResult> {
  recording ??= (async () => {
    const dir = deps.dir();
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `trace-${deps.date().toISOString().replace(/[:.]/g, '-')}.json`);
    await deps.tracing.startRecording(TRACE_CONFIG);
    deps.write(`recording for ${seconds} s`);
    try {
      await deps.wait(seconds * 1000);
    } finally {
      // Stop whatever happens, or tracing stays on (and slows everything).
      await deps.tracing.stopRecording(file);
    }
    const { size } = await fs.stat(file);
    lastTrace = file;
    deps.write(`saved ${path.basename(file)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
    await prune(dir, KEEP_TRACES, path.basename(file)).catch(() => { /* an old file in use: next time */ });
    return { name: path.basename(file), sizeBytes: size, seconds };
  })().finally(() => {
    recording = null;
  });
  return recording;
}
