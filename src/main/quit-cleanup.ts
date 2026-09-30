import { logger } from './logger.js';

/** Longest a quit waits for agents and shells to stop. Above killTree's own
 *  list + kill timeouts (10s each), so it only cuts off a hang. */
export const QUIT_CLEANUP_TIMEOUT_MS = 30_000;

/**
 * Run the quit-time cleanup, giving up after `timeoutMs`. The window is
 * already gone by then, so a cleanup that never settles would otherwise
 * leave an invisible Grove Bench process running. Never rejects.
 */
export async function runQuitCleanup(cleanup: () => Promise<unknown>, timeoutMs = QUIT_CLEANUP_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const outcome = await Promise.race([cleanup().then(() => 'done' as const), deadline]);
    if (outcome === 'timeout') logger.warn(`Quit cleanup still running after ${timeoutMs}ms; exiting anyway`);
    else logger.info('Cleanup complete');
  } catch (e) {
    logger.error('Cleanup error during quit:', e);
  } finally {
    clearTimeout(timer);
  }
}
