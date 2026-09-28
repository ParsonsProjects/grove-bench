import { describe, it, expect, afterEach } from 'vitest';
import { sessionRepoColor } from './session-repo-color.js';
import { store } from '../stores/sessions.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { DEFAULT_REPO_COLORS } from './repo-colors.js';

afterEach(() => {
  store.sessions = [];
  store.repos = [];
  settingsStore.current = { ...settingsStore.current, repoColors: {} };
});

describe('sessionRepoColor', () => {
  it("gives a conversation its project's colour", () => {
    store.repos = ['/repo-a', '/repo-b'];
    store.sessions = [{ id: 's1', branch: 'b', repoPath: '/repo-b', status: 'running' }] as any;
    expect(sessionRepoColor('s1')).toBe(DEFAULT_REPO_COLORS[1]);
  });

  it('uses a custom project colour', () => {
    store.repos = ['/repo-a'];
    store.sessions = [{ id: 's1', branch: 'b', repoPath: '/repo-a', status: 'running' }] as any;
    settingsStore.current = { ...settingsStore.current, repoColors: { '/repo-a': '#123456' } };
    expect(sessionRepoColor('s1')).toBe('#123456');
  });

  it('is null with one project and no custom colour, or for an unknown conversation', () => {
    store.repos = ['/repo-a'];
    store.sessions = [{ id: 's1', branch: 'b', repoPath: '/repo-a', status: 'running' }] as any;
    expect(sessionRepoColor('s1')).toBeNull();
    expect(sessionRepoColor('nope')).toBeNull();
  });
});
