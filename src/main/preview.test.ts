import { describe, it, expect, vi, afterEach } from 'vitest';
import { PreviewManager, within } from './preview.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('within', () => {
  it('resolves true when the promise settles in time and clears its timer', async () => {
    vi.useFakeTimers();
    await expect(within(Promise.resolve('ok'), 1000)).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('resolves true for a real promise', async () => {
    await expect(within(Promise.resolve('ok'), 1000)).resolves.toBe(true);
  });

  it('rethrows a rejection that happens in time', async () => {
    await expect(within(Promise.reject(new Error('ERR_CONNECTION_REFUSED')), 1000)).rejects.toThrow('ERR_CONNECTION_REFUSED');
  });

  it('resolves false on timeout, and a later rejection is not left unhandled', async () => {
    vi.useFakeTimers();
    let fail!: (e: Error) => void;
    const slow = new Promise((_resolve, reject) => { fail = reject; });
    const result = within(slow, 20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(result).resolves.toBe(false);
    // Vitest fails the run on an unhandled rejection. Promise.race keeps a
    // handler on the slow promise, so the late failure is handled.
    fail(new Error('late failure'));
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe('PreviewManager tool calls', () => {
  type Serial = <T>(sessionId: string, what: string, fn: () => Promise<T>) => Promise<T>;
  const serialOf = (m: PreviewManager) => (m as unknown as { serial: Serial }).serial.bind(m);

  it('runs one conversation\'s calls one at a time, in call order', async () => {
    const serial = serialOf(new PreviewManager());
    const order: string[] = [];
    let finishOpen!: () => void;
    const open = serial('s1', 'Open', () => new Promise<string>((r) => { finishOpen = () => { order.push('open'); r('opened'); }; }));
    const shot = serial('s1', 'Shot', async () => { order.push('shot'); return 'shot'; });
    const other = serial('s2', 'Other', async () => { order.push('other conversation'); return 'x'; });
    await other;
    expect(order).toEqual(['other conversation']);
    finishOpen();
    await expect(open).resolves.toBe('opened');
    await expect(shot).resolves.toBe('shot');
    expect(order).toEqual(['other conversation', 'open', 'shot']);
  });

  it('keeps going after a failed call', async () => {
    const serial = serialOf(new PreviewManager());
    await expect(serial('s1', 'Bad', async () => { throw new Error('No page is open.'); })).rejects.toThrow('No page is open.');
    await expect(serial('s1', 'Good', async () => 'ok')).resolves.toBe('ok');
  });

  it('fails a call that takes too long, so the turn does not stall', async () => {
    vi.useFakeTimers();
    const serial = serialOf(new PreviewManager());
    const stuck = serial('s1', 'The click', () => new Promise(() => {}));
    const check = expect(stuck).rejects.toThrow('The click took longer than 45s');
    await vi.advanceTimersByTimeAsync(45_000);
    await check;
    const next = serial('s1', 'Next', async () => 'ran');
    await vi.advanceTimersByTimeAsync(0);
    await expect(next).resolves.toBe('ran');
  });
});

describe('PreviewManager.closeAgentPage', () => {
  type Internals = { entries: Map<string, { agent: unknown; user: unknown }>; window: unknown };

  function setUp() {
    const m = new PreviewManager();
    const win = { isDestroyed: vi.fn(() => false), destroy: vi.fn() };
    const send = vi.fn();
    const internals = m as unknown as Internals;
    internals.window = { isDestroyed: () => false, webContents: { send } };
    const user = { visible: false };
    internals.entries.set('s1', { agent: { win }, user });
    return { m, win, send, internals, user };
  }

  it('closes the agent\'s page and tells the renderer, keeping yours', () => {
    const { m, win, send, internals, user } = setUp();

    m.closeAgentPage('s1');

    expect(win.destroy).toHaveBeenCalledOnce();
    expect(internals.entries.get('s1')).toMatchObject({ agent: null, user });
    expect(send).toHaveBeenCalledWith('preview:state', 's1', 'agent', null);
  });

  it('does nothing without a page', () => {
    const { m, win, send } = setUp();
    m.closeAgentPage('s1');
    m.closeAgentPage('s1');
    m.closeAgentPage('unknown');
    expect(win.destroy).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });
});
