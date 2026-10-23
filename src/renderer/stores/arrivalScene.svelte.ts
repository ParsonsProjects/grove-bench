/**
 * The first-turn scene: while a new conversation waits for its agent's first
 * reply, the chat shows the agent walking up the grove path to the bench,
 * sitting down and getting to work (see the arrival in lib/grove-walk.ts).
 * It begins when the first message goes out and ends at the first reply, or
 * when the agent stops without one. Only the start time is kept here, so
 * coming back to a conversation part way through carries on from where the
 * scene was rather than starting it over. Drawing it needs grove characters
 * on; OutputPanel checks that.
 */
class ArrivalSceneStore {
  private startedAt = $state<Record<string, number>>({});

  /** Start the scene for this conversation, unless it is already playing. */
  begin(sessionId: string): void {
    if (sessionId in this.startedAt) return;
    this.startedAt = { ...this.startedAt, [sessionId]: Date.now() };
  }

  end(sessionId: string): void {
    if (!(sessionId in this.startedAt)) return;
    const { [sessionId]: _, ...rest } = this.startedAt;
    this.startedAt = rest;
  }

  /** When this conversation's scene began (Date.now()), or null if none is playing. */
  for(sessionId: string): number | null {
    return this.startedAt[sessionId] ?? null;
  }
}

export const arrivalScene = new ArrivalSceneStore();
