/**
 * A thread's streamed text and thinking, merged before they go to the window.
 *
 * Claude Code runs with partial messages on, so it writes a line for every
 * few tokens of text or thinking, and each line became its own IPC message
 * to the renderer. With a couple of dozen threads streaming at once, those
 * are most of the messages main sends. Here a thread's deltas wait up to
 * STREAM_FLUSH_MS and go out as one event.
 *
 * Order is kept. A delta only joins the deltas just before it of the same
 * kind (text after thinking sends the thinking first), and the session's
 * emit sends what is held before any other event of the thread, so the final
 * assistant_text, a tool call or an error never overtakes the text streamed
 * before it.
 */
import type { AgentEvent } from '../shared/types.js';

export type StreamDelta = Extract<AgentEvent, { type: 'partial_text' | 'partial_thinking' }>;

/** How long a delta may wait for more. Two frames at 60 Hz: a streaming
 *  thread sends at most about 30 messages a second however fast the agent
 *  writes, and the text shows at most 33 ms later. The renderer only draws
 *  streamed text every 80 ms anyway (STREAM_FLUSH_MS in messages.svelte.ts),
 *  so it still gets two or three messages per draw. */
export const STREAM_FLUSH_MS = 33;

export function isStreamDelta(event: AgentEvent): event is StreamDelta {
  return event.type === 'partial_text' || event.type === 'partial_thinking';
}

/** One thread's held deltas. `send` gets the merged events, in order. */
export class StreamDeltas {
  private held: StreamDelta | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly send: (event: StreamDelta) => void,
    private readonly delayMs = STREAM_FLUSH_MS,
  ) {}

  /** Hold a delta, joined to the one held if it is of the same kind. The
   *  first held is sent at most `delayMs` later. */
  add(delta: StreamDelta): void {
    if (this.held && this.held.type !== delta.type) this.flush();
    if (this.held) {
      // Our own copy (below), so it can be added to.
      this.held.text += delta.text;
      return;
    }
    this.held = { type: delta.type, text: delta.text };
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.delayMs);
  }

  /** Send what is held now. Does nothing when nothing is. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const held = this.held;
    if (!held) return;
    this.held = null;
    this.send(held);
  }
}
