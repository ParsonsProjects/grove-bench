import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const MAX_FILES = 5;
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

let logStream: fs.WriteStream | null = null;
let logDir: string;

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
  }
  return logStream;
}

function formatMessage(level: string, msg: string, ...args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const extra = args.length ? ' ' + args.map((a) => JSON.stringify(a)).join(' ') : '';
  return `[${timestamp}] [${level}] ${msg}${extra}\n`;
}

export const logger = {
  info(msg: string, ...args: unknown[]) {
    const line = formatMessage('INFO', msg, ...args);
    ensureStream().write(line);
  },
  warn(msg: string, ...args: unknown[]) {
    const line = formatMessage('WARN', msg, ...args);
    console.warn(msg, ...args);
    ensureStream().write(line);
  },
  error(msg: string, ...args: unknown[]) {
    const line = formatMessage('ERROR', msg, ...args);
    console.error(msg, ...args);
    ensureStream().write(line);
  },
  close() {
    logStream?.end();
    logStream = null;
  },
};
