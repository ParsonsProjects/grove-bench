/**
 * A log file that rotates by size: name.log, then name.log.1 and so on, up
 * to `maxFiles` files. The size is checked when the file opens and every
 * `checkEvery` writes after, so an app left running for days rotates too.
 * The app log (logger.ts) and the performance log (perf-log.ts) both use it.
 */
import fs from 'node:fs';

export interface RotatingLogOptions {
  /** The file's path, worked out when it first opens. */
  path: () => string;
  maxSize: number;
  /** Files kept, counting the one being written. */
  maxFiles: number;
  /** A line written at the top of each stream opened. */
  header?: () => string;
  checkEvery?: number;
}

export interface RotatingLog {
  /** Append `text` (with its own newline). Can throw if the folder can't be
   *  reached; a write that fails later is dropped. */
  write(text: string): void;
  /** Close the stream (at quit). The next write reopens it. */
  close(): void;
}

function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0; // no file yet
  }
}

export function createRotatingLog({ path, maxSize, maxFiles, header, checkEvery = 500 }: RotatingLogOptions): RotatingLog {
  let stream: fs.WriteStream | null = null;
  let writesSinceCheck = 0;

  /** Shift file → file.1 → file.2 ..., dropping the oldest. */
  function rotate(file: string): void {
    if (sizeOf(file) < maxSize) return;
    for (let i = maxFiles - 1; i >= 1; i--) {
      const from = i === 1 ? file : `${file}.${i - 1}`;
      try { fs.renameSync(from, `${file}.${i}`); } catch { /* not there yet */ }
    }
  }

  function open(): fs.WriteStream {
    const file = path();
    rotate(file);
    const s = fs.createWriteStream(file, { flags: 'a' });
    // A file that can't be written (locked, disk full) must not take the app
    // down with it: drop the stream, and the next write tries again.
    s.on('error', () => { if (stream === s) stream = null; });
    if (header) s.write(header());
    writesSinceCheck = 0;
    return s;
  }

  return {
    write(text) {
      stream ??= open();
      stream.write(text);
      if (++writesSinceCheck >= checkEvery) {
        writesSinceCheck = 0;
        if (sizeOf(path()) >= maxSize) {
          // The next write rotates and reopens.
          stream.end();
          stream = null;
        }
      }
    },
    close() {
      stream?.end();
      stream = null;
    },
  };
}
