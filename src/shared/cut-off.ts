/**
 * Turns cut off when Grove Bench stopped: quit, closed to install an update,
 * ended with the Windows session, or crashed. Quitting writes a turn_cut_off
 * (with why) into each running thread's history before its process_exit
 * (agent-session.ts shutDown). A crash writes nothing, and the history just
 * ends mid-turn: the next start finds that (inferred) and writes one with
 * reason 'unknown' when the thread's agent starts again.
 *
 * The thread then offers Continue (a prompt asking the agent to check where
 * it got to and carry on, CONTINUE_PROMPT) or Dismiss, until one of them, or
 * any prompt, answers it. Meanwhile it counts as needing the user: amber in
 * the sidebar, and in the taskbar badge and the tray menu.
 */
import { subagentParent, type AgentEvent, type CutOff, type CutOffReason } from './types.js';

/** What Continue sends. It says the last step may not have finished, so the
 *  agent checks before it repeats or builds on it. */
export const CONTINUE_PROMPT = 'Grove Bench closed before you finished your last turn, so your last step may not have completed. Check where you got to, then carry on.';

/**
 * The cut-off turn `events` (a thread's history) leaves unanswered, if any:
 * walking back from the end, a turn_cut_off before any prompt, result or
 * dismissal. The process_exit written just after one doesn't count as an
 * end of its own. Subagents' events are skipped.
 *
 * `inferTail`: the thread has no agent running (it was stopped, or is only
 * now starting again), so a turn that started and never ended (a prompt with
 * no result or exit after it, as a crash leaves it) was cut off too. Those
 * come back `inferred`, with reason 'unknown' and no time.
 */
export function openCutOff(events: readonly AgentEvent[], inferTail = false): (CutOff & { inferred?: true }) | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (subagentParent(e) !== undefined) continue;
    switch (e.type) {
      case 'turn_cut_off':
        return { reason: e.reason, ...(e.at !== undefined ? { at: e.at } : {}) };
      case 'process_exit':
        if (events[i - 1]?.type === 'turn_cut_off') continue;
        return null;
      case 'turn_cut_off_dismissed':
      case 'result':
        return null;
      case 'user_message':
        if (e.steer) continue;
        return inferTail ? { reason: 'unknown', inferred: true } : null;
    }
  }
  return null;
}

const HH_MM = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Why it was cut off, as a sentence: the notice's body. */
export function cutOffReasonText(reason: CutOffReason, at?: number): string {
  const when = at !== undefined ? ` at ${HH_MM(at)}` : '';
  switch (reason) {
    case 'quit': return `Grove Bench was closed${when} while the agent was still working.`;
    case 'update': return `Grove Bench closed to install an update${when}, while the agent was still working.`;
    case 'windows': return `Windows shut down or signed out${when} while the agent was still working.`;
    case 'unknown': return `Grove Bench stopped${when} before the agent finished.`;
  }
}

/** The line a cut-off turn leaves in the thread once it's answered. */
export function cutOffDivider(reason: CutOffReason, at?: number): string {
  const when = at !== undefined ? ` at ${HH_MM(at)}` : '';
  switch (reason) {
    case 'quit': return `Cut off${when} when Grove Bench was closed`;
    case 'update': return `Cut off${when} when Grove Bench closed to install an update`;
    case 'windows': return `Cut off${when} when Windows shut down or signed out`;
    case 'unknown': return `Cut off${when} when Grove Bench stopped`;
  }
}
