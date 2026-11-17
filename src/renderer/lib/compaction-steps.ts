import type { MemoryCompactionStep } from '../../shared/types.js';
import { formatFileSize } from './file-attachments.js';

/** A step's duration: "4.2s" under a minute, else "1:05". */
export function formatStepDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * A compaction step's timing for the steps list: how long it has run so far,
 * or, once it ended, how long the agent took to start and the model to reply
 * (when the agent reports its start), then the prompt's and reply's sizes.
 */
export function stepTiming(step: MemoryCompactionStep, now: number): string {
  const parts: string[] = [];
  if (step.state === 'running') {
    parts.push(`${formatStepDuration(now - step.startedAt)} so far`);
  } else if (step.durationMs !== undefined) {
    if (step.startupMs !== undefined) {
      parts.push(`agent up ${formatStepDuration(step.startupMs)}`, `reply ${formatStepDuration(step.durationMs - step.startupMs)}`);
    } else {
      parts.push(formatStepDuration(step.durationMs));
    }
  }
  parts.push(`${formatFileSize(step.inputBytes)} in`);
  if (step.outputBytes !== undefined) parts.push(`${formatFileSize(step.outputBytes)} out`);
  return parts.join(' · ');
}
