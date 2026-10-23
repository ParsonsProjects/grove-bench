import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestPermission } from './session-permissions.js';
import type { ManagedSession } from './session-types.js';

vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

/** A conversation's process as main starts it: the counter from 0. */
function freshSession(): ManagedSession {
  return {
    id: 's1',
    permissionMode: 'default',
    worktreePath: '/w',
    pendingPermissions: new Map(),
    permRequestCounter: 0,
  } as unknown as ManagedSession;
}

afterEach(() => vi.useRealTimers());

describe('requestPermission ids', () => {
  it('does not repeat an id when the conversation starts again', () => {
    vi.useFakeTimers();
    const ids: string[] = [];
    const emit = (e: { type: string; requestId?: string }) => { if (e.type === 'permission_request') ids.push(e.requestId!); };
    const request = { requestId: 'adapter_1', toolName: 'Bash', toolUseId: 't1', toolInput: { command: 'ls' } };

    void requestPermission(freshSession(), request, emit as never);
    void requestPermission(freshSession(), request, emit as never);

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
