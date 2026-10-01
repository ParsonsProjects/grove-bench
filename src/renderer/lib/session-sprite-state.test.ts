import { describe, it, expect, afterEach } from 'vitest';
import { sessionSpriteState } from './session-sprite-state.js';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';

afterEach(() => {
  store.needsAttention = {};
  store.deferredResume = {};
  messageStore.setIsRunning('s1', false);
});

describe('sessionSpriteState', () => {
  it('follows the conversation status', () => {
    expect(sessionSpriteState({ id: 's1', status: 'running' })).toBe('ready');
    expect(sessionSpriteState({ id: 's1', status: 'stopped' })).toBe('stopped');
    expect(sessionSpriteState({ id: 's1', status: 'sleeping' })).toBe('sleeping');
  });

  it('shows a tab restored at startup as sleeping, not completed', () => {
    store.deferResume('s1');
    expect(sessionSpriteState({ id: 's1', status: 'stopped' })).toBe('sleeping');
  });

  it('shows a running turn and an unread one', () => {
    messageStore.setIsRunning('s1', true);
    expect(sessionSpriteState({ id: 's1', status: 'running' })).toBe('working');
    messageStore.setIsRunning('s1', false);
    store.needsAttention = { s1: true };
    expect(sessionSpriteState({ id: 's1', status: 'running' })).toBe('unread');
  });

  it('shows a removal in progress over everything else', () => {
    expect(sessionSpriteState({ id: 's1', status: 'running' }, true)).toBe('removing');
  });
});
