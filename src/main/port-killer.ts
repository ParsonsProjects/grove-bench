import { exec } from 'node:child_process';
import { logger } from './logger.js';

/** Kill the process listening on a given port. */
export function killProcessOnPort(port: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (process.platform === 'win32') {
      // Find PID listening on the port, then kill the process tree
      exec(`netstat -ano | findstr LISTENING | findstr :${port}`, (err, stdout) => {
        if (err || !stdout.trim()) { resolve(); return; }
        const pids = new Set<string>();
        for (const line of stdout.trim().split('\n')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
        }
        if (pids.size === 0) { resolve(); return; }
        let remaining = pids.size;
        for (const pid of pids) {
          exec(`taskkill /F /T /PID ${pid}`, (killErr) => {
            if (killErr) {
              logger.warn(`Failed to kill PID ${pid} on port ${port}: ${killErr.message}`);
            }
            if (--remaining === 0) resolve();
          });
        }
      });
    } else {
      exec(`lsof -ti :${port}`, (err, stdout) => {
        if (err || !stdout.trim()) { resolve(); return; }
        const pids = stdout.trim().split('\n').filter(Boolean);
        if (pids.length === 0) { resolve(); return; }
        exec(`kill -9 ${pids.join(' ')}`, () => resolve());
      });
    }
  });
}
