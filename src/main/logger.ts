import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const MAX_FILES = 5;
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
/** Re-check the file size every N writes so a long-running instance rotates
 *  mid-run instead of only at startup. */
const ROTATE_CHECK_EVERY = 500;

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Minimum level written to disk. Override with GROVE_LOG_LEVEL=info|warn|error. */
function resolveMinLevel(): Level {
  const env = (process.env.GROVE_LOG_LEVEL || '').toLowerCase();
  return env in LEVEL_RANK ? (env as Level) : 'debug';
}
const minLevel = resolveMinLevel();

let logStream: fs.WriteStream | null = null;
let logDir: string;
let writesSinceCheck = 0;

function getLogDir(): string {
  if (!logDir) {
    logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

function getLogPath(): string {
  return path.join(getLogDir(), 'grove-bench.log');
}

function rotate() {
  const logPath = getLogPath();
  try {
    const stat = fs.statSync(logPath);
    if (stat.size < MAX_SIZE) return;
  } catch {
    return; // file doesn't exist
  }

  // Shift existing logs
  for (let i = MAX_FILES - 1; i >= 1; i--) {
    const from = i === 1 ? logPath : `${logPath}.${i - 1}`;
    const to = `${logPath}.${i}`;
    try {
      fs.renameSync(from, to);
    } catch { /* ignore */ }
  }
}

function ensureStream(): fs.WriteStream {
  if (!logStream) {
    rotate();
    logStream = fs.createWriteStream(getLogPath(), { flags: 'a' });
    writesSinceCheck = 0;
  }
  return logStream;
}

function write(level: Level, line: string): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
  ensureStream().write(line);
  if (++writesSinceCheck >= ROTATE_CHECK_EVERY) {
    writesSinceCheck = 0;
    let size = 0;
    try { size = fs.statSync(getLogPath()).size; } catch { /* ignore */ }
    if (size >= MAX_SIZE) {
      // Close the current stream; the next write rotates and reopens.
      logStream?.end();
      logStream = null;
    }
  }
}

function formatMessage(level: string, msg: string, ...args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const extra = args.length ? ' ' + args.map((a) => JSON.stringify(a)).join(' ') : '';
  return `[${timestamp}] [${level}] ${msg}${extra}\n`;
}

export const logger = {
  debug(msg: string, ...args: unknown[]) {
    if (LEVEL_RANK.debug < LEVEL_RANK[minLevel]) return; // skip formatting too
    write('debug', formatMessage('DEBUG', msg, ...args));
  },
  info(msg: string, ...args: unknown[]) {
    write('info', formatMessage('INFO', msg, ...args));
  },
  warn(msg: string, ...args: unknown[]) {
    console.warn(msg, ...args);
    write('warn', formatMessage('WARN', msg, ...args));
  },
  error(msg: string, ...args: unknown[]) {
    console.error(msg, ...args);
    write('error', formatMessage('ERROR', msg, ...args));
  },
  close() {
    logStream?.end();
    logStream = null;
  },
};
