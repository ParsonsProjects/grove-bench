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
 * walking back from the end, a turn_cut_off before any prompt (not a steer)
 * or dismissal. Only those answer it, as in the thread (openCutOffIn in the
 * messages store): an agent that started again and exited, or a result of
 * its own, doesn't. Subagents' events are skipped.
 *
 * `inferTail`: the thread has no agent running (it was stopped, or is only
 * now starting again), so a turn that started and never ended (a prompt with
 * no result or exit after it, as a crash leaves it) was cut off too. Those
 * come back `inferred`, with reason 'unknown' and no time.
 */
export function openCutOff(events: readonly AgentEvent[], inferTail = false): (CutOff & { inferred?: true }) | null {
  // A result or an exit since: the turn of a prompt before it ended.
  let ended = false;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (subagentParent(e) !== undefined) continue;
    switch (e.type) {
      case 'turn_cut_off':
        return { reason: e.reason, ...(e.at !== undefined ? { at: e.at } : {}) };
      case 'turn_cut_off_dismissed':
        return null;
      case 'result':
      case 'process_exit':
        ended = true;
        break;
      case 'user_message':
        if (e.steer) continue;
        return inferTail && !ended ? { reason: 'unknown', inferred: true } : null;
    }
  }
  return null;
}

/** When, for the notice: the time, with the day too if it wasn't today
 *  (the notice waits until it's answered, which can be days later). */
function when(at: number | undefined, now = Date.now()): string {
  if (at === undefined) return '';
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date(now).toDateString()) return ` at ${time}`;
  return ` on ${date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} at ${time}`;
}

/** Why it was cut off, as a sentence: the notice's body. `several`: said
 *  of more than one thread (the launch notice). */
export function cutOffReasonText(reason: CutOffReason, at?: number, several = false): string {
  const t = when(at);
  const working = several ? 'the agents were still working' : 'the agent was still working';
  switch (reason) {
    case 'quit': return `Grove Bench was closed${t} while ${working}.`;
    case 'update': return `Grove Bench closed to install an update${t}, while ${working}.`;
    case 'windows': return `Windows shut down or signed out${t} while ${working}.`;
    case 'unknown': return `Grove Bench stopped${t} before ${several ? 'the agents' : 'the agent'} finished.`;
  }
}

/** The line a cut-off turn leaves in the thread once it's answered. */
export function cutOffDivider(reason: CutOffReason, at?: number): string {
  const t = when(at);
  switch (reason) {
    case 'quit': return `Cut off${t} when Grove Bench was closed`;
    case 'update': return `Cut off${t} when Grove Bench closed to install an update`;
    case 'windows': return `Cut off${t} when Windows shut down or signed out`;
    case 'unknown': return `Cut off${t} when Grove Bench stopped`;
  }
}
