import { describe, it, expect } from 'vitest';
import { forgetConversation } from './forget-conversation.js';
import { store } from '../stores/sessions.svelte.js';
import { prStore } from '../stores/pr.svelte.js';
import { reviewStore } from '../stores/review.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import type { PrInfo } from '../../shared/types.js';

describe('forgetConversation', () => {
  it('drops the conversation from every store that keeps per-conversation state', () => {
    const id = 'deleted-1';
    store.sessions = [{ id, branch: 'b', repoPath: '/r', status: 'stopped' }] as never;
    store.pushRecentlyClosed(id);
    messageStore.addUserMessage(id, 'hi');
    prStore.prsBySession = { ...prStore.prsBySession, [id]: [{ number: 1 } as PrInfo] };
    reviewStore.setViewed(id, 'a.ts', 'hash', true);
    expect(localStorage.getItem(`grove-bench:review:${id}`)).not.toBeNull();

    forgetConversation(id);

    expect(store.sessions).toEqual([]);
    expect(store.popRecentlyClosed()).toBeNull();
    expect(messageStore.messagesBySession).not.toHaveProperty(id);
    expect(prStore.prsBySession).not.toHaveProperty(id);
    expect(reviewStore.isViewed(id, 'a.ts', 'hash')).toBe(false);
    expect(localStorage.getItem(`grove-bench:review:${id}`)).toBeNull();
  });
});
