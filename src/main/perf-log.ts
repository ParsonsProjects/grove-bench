/**
 * The performance log: performance.log in the logs folder, beside the app
 * log. Freezes, how long new conversations, resumes and wakes took step by
 * step, and a health line every few minutes go here, one per line, so
 * tracking down slowness needs one file. It never leaves this computer.
 *
 *   [2026-10-01T12:00:00.000Z] [freeze] main process didn't run for 196 ms; ...
 *   [2026-10-01T12:00:04.210Z] [steps] new conversation 1a2b3c4d ready after 4210 ms: ...
 */
import fs from 'node:fs';
import path from 'node:path';
import { getLogDir } from './logger.js';

/** Over this size at launch, the file is kept as performance.log.1 and a new
 *  one started (one older file is kept). */
const MAX_SIZE = 5 * 1024 * 1024;

export type PerfKind = 'freeze' | 'steps' | 'health' | 'trace';

let stream: fs.WriteStream | null = null;

export function perfLogPath(): string {
  return path.join(getLogDir(), 'performance.log');
}

function open(): fs.WriteStream {
  const file = perfLogPath();
  try {
    if (fs.statSync(file).size >= MAX_SIZE) fs.renameSync(file, `${file}.1`);
  } catch { /* no file yet */ }
  const s = fs.createWriteStream(file, { flags: 'a' });
  // A file that can't be written (locked, disk full) must not take the app
  // down with it; the lines are lost, nothing else.
  s.on('error', () => { if (stream === s) stream = null; });
  return s;
}

/** Add a line to the performance log. Never throws: measuring must not
 *  break what it measures, so a line that can't be written is lost. */
export function perfLine(kind: PerfKind, message: string): void {
  try {
    stream ??= open();
    stream.write(`[${new Date().toISOString()}] [${kind}] ${message}\n`);
  } catch { /* the logs folder can't be reached */ }
}

/** Close the file (at quit). The next line reopens it. */
export function closePerfLog(): void {
  stream?.end();
  stream = null;
}
