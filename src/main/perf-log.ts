/**
 * The performance log: performance.log in the logs folder, beside the app
 * log. Freezes, how long new conversations, resumes and wakes took step by
 * step, and a health line every few minutes go here, one per line, so
 * tracking down slowness needs one file. It never leaves this computer.
 *
 *   [2026-10-01T12:00:00.000Z] [freeze] main process didn't run for 196 ms; ...
 *   [2026-10-01T12:00:04.210Z] [steps] new conversation 1a2b3c4d ready after 4210 ms: ...
 */
import path from 'node:path';
import { getLogDir } from './logger.js';
import { createRotatingLog } from './rotating-log.js';

export type PerfKind = 'freeze' | 'steps' | 'health' | 'trace';

export function perfLogPath(): string {
  return path.join(getLogDir(), 'performance.log');
}

/** Up to 5 MB, and one older file (performance.log.1) kept. */
const file = createRotatingLog({ path: perfLogPath, maxSize: 5 * 1024 * 1024, maxFiles: 2 });

/** Add a line to the performance log. Never throws: measuring must not
 *  break what it measures, so a line that can't be written is lost. */
export function perfLine(kind: PerfKind, message: string): void {
  try {
    file.write(`[${new Date().toISOString()}] [${kind}] ${message}\n`);
  } catch { /* the logs folder can't be reached */ }
}

/** Close the file (at quit). The next line reopens it. */
export function closePerfLog(): void {
  file.close();
}
