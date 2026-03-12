import { execFile } from 'node:child_process';
import { logger } from './logger.js';

/** Kill the process listening on a given port. */
export function killProcessOnPort(port: number): Promise<void> {
  const portStr = String(port);
  return new Promise<void>((resolve) => {
    if (process.platform === 'win32') {
      // Find PID listening on the port, then kill the process tree
      execFile('netstat', ['-ano'], (err, stdout) => {
        if (err || !stdout.trim()) { resolve(); return; }
        const pids = new Set<string>();
        for (const line of stdout.trim().split('\n')) {
          // Match lines with LISTENING state and exact port (e.g. ":3000 " not ":30001")
          const parts = line.trim().split(/\s+/);
          if (!parts.includes('LISTENING')) continue;
          const localAddr = parts[1] ?? '';
          if (!localAddr.endsWith(':' + portStr)) continue;
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
        }
        if (pids.size === 0) { resolve(); return; }
        let remaining = pids.size;
        for (const pid of pids) {
          execFile('taskkill', ['/F', '/T', '/PID', pid], (killErr) => {
            if (killErr) {
              logger.warn(`Failed to kill PID ${pid} on port ${port}: ${killErr.message}`);
            }
            if (--remaining === 0) resolve();
          });
        }
      });
    } else {
      execFile('lsof', ['-ti', `:${portStr}`], (err, stdout) => {
        if (err || !stdout.trim()) { resolve(); return; }
        const pids = stdout.trim().split('\n').filter(p => /^\d+$/.test(p));
        if (pids.length === 0) { resolve(); return; }
        execFile('kill', ['-9', ...pids], () => resolve());
      });
    }
  });
}
