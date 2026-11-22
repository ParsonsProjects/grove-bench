/**
 * Steers: messages the user sends into a Claude Code turn that is already
 * running. Claude Code takes a message from its input stream mid-turn and
 * reads it once its current tool calls finish (`priority: 'next'`; 'now'
 * would cancel the tool calls in flight). Until then it is waiting in Claude
 * Code's own queue, where Grove can't take it back: the SDK has no method for
 * the CLI's `cancel_async_message`. So Grove holds a steer for a few seconds
 * first (the renderer's Take back), and only then sends it.
 *
 * This tracker follows each steer it was given, by the uuid it was sent
 * with, and reports when Claude reads it or lets it go:
 *
 * - Read: the uuid shows up in a frame's `user_message_uuids` (the SDK's
 *   documented list of the user messages a turn has consumed, folded-in ones
 *   included), or in a `command_lifecycle` frame whose state is `started`.
 *   That frame isn't in the SDK's types; T3 Code reads it the same way, so it
 *   is treated as a bonus, never relied on.
 * - Dropped: a `command_lifecycle` frame says `cancelled`, `discarded` or
 *   `refused`, or the stream ended (release) with it unread.
 *
 * A turn can end (its result arrives) with a steer still unread. Claude Code
 * then runs that steer as the next turn by itself. Grove keeps that as one
 * turn: a successful result is held, and dropped once Claude starts
 * answering the steer, whose own result then ends the turn (carrying the
 * dropped one's time and turn count, which aren't running totals). A result
 * that reports an error is never held, so the error always shows. If Claude
 * drops the steer, the held result goes out. If nothing arrives for a while,
 * the generator calls holdOver(): the result goes out, but the steer stays
 * pending, because Claude Code still has it and may yet run it. Reporting it
 * dropped then would have the renderer send it a second time.
 */
type SDKMessage = import('@anthropic-ai/claude-agent-sdk').SDKMessage;

/** How long a held result waits, from when it was held, for Claude to start
 *  an unread steer. */
export const STEER_HOLD_MS = 15_000;

export type SteerEvent = { type: 'steer_read'; uuid: string } | { type: 'steer_dropped'; uuid: string };

export interface SteerObservation {
  /** Steer events, in the order they happened. */
  events: SteerEvent[];
  /** SDK messages to handle now, in order: possibly a released result, then
   *  this message (unless it was held or is a lifecycle frame). */
  pass: SDKMessage[];
}

const DROPPED_STATES = new Set(['cancelled', 'discarded', 'refused']);

/** What a dropped held result had that the next result's own figures don't
 *  include: they cover one result each, not the query so far. */
interface Carried {
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
}

/** The uuids a frame says the turn has consumed. */
function consumedUuids(message: SDKMessage): string[] {
  const list: unknown = Reflect.get(message, 'user_message_uuids');
  if (Array.isArray(list)) return list.filter((u): u is string => typeof u === 'string');
  const one: unknown = Reflect.get(message, 'user_message_uuid');
  return typeof one === 'string' ? [one] : [];
}

/** A `command_lifecycle` frame's uuid and state, or null. */
function lifecycle(message: SDKMessage): { uuid: string; state: string } | null {
  if ((message as { type: string }).type !== 'command_lifecycle') return null;
  const uuid: unknown = Reflect.get(message, 'command_uuid');
  const state: unknown = Reflect.get(message, 'state');
  return typeof uuid === 'string' && typeof state === 'string' ? { uuid, state } : null;
}

/** A result that ended its turn without an error: the only kind held. */
function isSuccess(message: SDKMessage): boolean {
  return message.type === 'result' && message.subtype === 'success' && !message.is_error;
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export class SteerTracker {
  /** Sent and not read yet. */
  private pending = new Set<string>();
  /** Reported dropped when the stream ended; a late read is still reported. */
  private released = new Set<string>();
  private held: SDKMessage | null = null;
  private carried: Carried | null = null;

  add(uuid: string): void {
    this.pending.add(uuid);
  }

  /** Steers sent and not read yet. */
  get unread(): string[] {
    return [...this.pending];
  }

  /** Whether a result is being held for an unread steer. */
  get holding(): boolean {
    return this.held !== null;
  }

  observe(message: SDKMessage): SteerObservation {
    const events: SteerEvent[] = [];
    const pass: SDKMessage[] = [];
    const life = lifecycle(message);

    const read = life ? (life.state === 'started' ? [life.uuid] : []) : consumedUuids(message);
    for (const uuid of read) {
      if (this.pending.delete(uuid)) {
        events.push({ type: 'steer_read', uuid });
        // Claude is answering the steer now: its result ends the turn, and
        // brings the held one's time with it.
        if (this.held) this.carry(this.held);
        this.held = null;
      } else if (this.released.delete(uuid)) {
        events.push({ type: 'steer_read', uuid });
      }
    }

    if (life && DROPPED_STATES.has(life.state) && this.pending.delete(life.uuid)) {
      events.push({ type: 'steer_dropped', uuid: life.uuid });
      if (this.pending.size === 0 && this.held) {
        pass.push(this.held);
        this.held = null;
      }
    }

    // Lifecycle frames aren't for the rest of the adapter.
    if (life || (message as { type: string }).type === 'command_lifecycle') return { events, pass };

    if (message.type === 'result' && this.pending.size > 0 && isSuccess(message)) {
      this.held = message;
      return { events, pass };
    }
    pass.push(this.withCarried(message));
    return { events, pass };
  }

  /** The hold ran out: send the held result. The steers stay pending, as
   *  Claude Code still has them, so a later read is still reported. */
  holdOver(): SteerObservation {
    const pass = this.held ? [this.held] : [];
    this.held = null;
    return { events: [], pass };
  }

  /** The stream ended: send the held result, and count the steers still
   *  unread as dropped (the agent that had them is gone). */
  release(): SteerObservation {
    const events: SteerEvent[] = this.unread.map((uuid) => ({ type: 'steer_dropped', uuid }));
    for (const uuid of this.pending) this.released.add(uuid);
    this.pending.clear();
    const pass = this.held ? [this.held] : [];
    this.held = null;
    return { events, pass };
  }

  private carry(result: SDKMessage): void {
    const prev = this.carried ?? { durationMs: 0, durationApiMs: 0, numTurns: 0 };
    this.carried = {
      durationMs: prev.durationMs + num(Reflect.get(result, 'duration_ms')),
      durationApiMs: prev.durationApiMs + num(Reflect.get(result, 'duration_api_ms')),
      numTurns: prev.numTurns + num(Reflect.get(result, 'num_turns')),
    };
  }

  /** The next result, with a dropped held result's time and turns added. */
  private withCarried(message: SDKMessage): SDKMessage {
    if (message.type !== 'result' || !this.carried) return message;
    const carried = this.carried;
    this.carried = null;
    return {
      ...message,
      duration_ms: num(message.duration_ms) + carried.durationMs,
      duration_api_ms: num(message.duration_api_ms) + carried.durationApiMs,
      num_turns: num(message.num_turns) + carried.numTurns,
    };
  }
}
