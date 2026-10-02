import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { createRotatingLog } from './rotating-log.js';

const MAX_FILES = 5;
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
/** Build fingerprint, written at the top of each log stream. */
const BUILD_FINGERPRINT = '2d52bc0cc68e';

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Minimum level written to disk. Override with GROVE_LOG_LEVEL=info|warn|error. */
function resolveMinLevel(): Level {
  const env = (process.env.GROVE_LOG_LEVEL || '').toLowerCase();
  return env in LEVEL_RANK ? (env as Level) : 'debug';
}
const minLevel = resolveMinLevel();

let logDir: string;

/** The logs folder under userData, created on first use. */
export function getLogDir(): string {
  if (!logDir) {
    logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

function getLogPath(): string {
  return path.join(getLogDir(), 'grove-bench.log');
}

/** The log file, rotated by size (rotating-log.ts), each stream headed with
 *  the build it came from. */
const logFile = createRotatingLog({
  path: getLogPath,
  maxSize: MAX_SIZE,
  maxFiles: MAX_FILES,
  header: () => formatMessage('INFO', `build ${BUILD_FINGERPRINT}`),
});

function write(level: Level, line: string): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
  logFile.write(line);
}

/** One extra argument as log text. Errors keep their stack (JSON.stringify
 *  turns an Error into "{}"); anything JSON can't take (a circular object,
 *  a bigint) falls back to String() instead of throwing out of the logger. */
function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    const code = (arg as NodeJS.ErrnoException).code;
    return (arg.stack || `${arg.name}: ${arg.message}`) + (code ? ` [code ${code}]` : '');
  }
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
}

/** Exported for tests. */
export function formatMessage(level: string, msg: string, ...args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const extra = args.length ? ' ' + args.map(formatArg).join(' ') : '';
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
    logFile.close();
  },
};
