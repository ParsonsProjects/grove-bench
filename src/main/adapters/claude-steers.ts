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
 *   `refused`.
 *
 * A turn can end (its result arrives) with a steer still unread. Claude Code
 * then runs that steer as the next turn by itself. Grove keeps that as one
 * turn: the result is held, and dropped once Claude starts answering the
 * steer, whose own result then ends the turn. If Claude drops the steer, the
 * held result goes out. If nothing arrives for a while, the generator calls
 * release(): the result goes out and the steers count as dropped, and a late
 * read of one is still reported, so the renderer can take it off the queue.
 */
type SDKMessage = import('@anthropic-ai/claude-agent-sdk').SDKMessage;

/** How long a held result waits for Claude to start an unread steer. */
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

export class SteerTracker {
  /** Sent and not read yet. */
  private pending = new Set<string>();
  /** Reported dropped after a hold ran out; a late read is still reported. */
  private released = new Set<string>();
  private held: SDKMessage | null = null;

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
        // Claude is answering the steer now: its result ends the turn.
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

    if (message.type === 'result' && this.pending.size > 0) {
      this.held = message;
      return { events, pass };
    }
    pass.push(message);
    return { events, pass };
  }

  /** The hold ran out, or the stream ended: send the held result, and count
   *  the steers still unread as dropped. */
  release(): SteerObservation {
    const events: SteerEvent[] = this.unread.map((uuid) => ({ type: 'steer_dropped', uuid }));
    for (const uuid of this.pending) this.released.add(uuid);
    this.pending.clear();
    const pass = this.held ? [this.held] : [];
    this.held = null;
    return { events, pass };
  }
}
