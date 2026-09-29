import { describe, it, expect, vi } from 'vitest';
import { previewToolHandlers, GROVE_PREVIEW_READ_TOOL_NAMES, GROVE_PREVIEW_ACTION_TOOL_NAMES } from './preview-mcp-server.js';
import type { PreviewOperations } from './types.js';

function fakeOps(overrides: Partial<PreviewOperations> = {}): PreviewOperations {
  return {
    open: vi.fn(async () => 'Opened http://localhost:5173/'),
    screenshot: vi.fn(async () => ({ data: Buffer.from('png-bytes'), mimeType: 'image/png' as const, width: 1280, height: 800, url: 'http://localhost:5173/' })),
    read: vi.fn(async () => 'URL: http://localhost:5173/'),
    logs: vi.fn(async () => 'No console or network messages since the last check.'),
    click: vi.fn(async () => 'Clicked <button> "save".'),
    type: vi.fn(async () => 'Typed "a" into <input>.'),
    ...overrides,
  };
}

describe('previewToolHandlers', () => {
  it('passes open arguments through and returns the text', async () => {
    const ops = fakeOps();
    const res = await previewToolHandlers(ops).open({ url: 'localhost:5173', width: 390, height: 844 });
    expect(ops.open).toHaveBeenCalledWith({ url: 'localhost:5173', width: 390, height: 844 });
    expect(res).toEqual({ content: [{ type: 'text', text: 'Opened http://localhost:5173/' }] });
  });

  it('returns a screenshot as a caption and a base64 image', async () => {
    const res = await previewToolHandlers(fakeOps()).screenshot();
    expect(res.content).toEqual([
      { type: 'text', text: 'Screenshot of http://localhost:5173/ (1280×800)' },
      { type: 'image', data: Buffer.from('png-bytes').toString('base64'), mimeType: 'image/png' },
    ]);
    expect(res.isError).toBeUndefined();
  });

  it('turns a thrown error into a tool error', async () => {
    const ops = fakeOps({ read: vi.fn(async () => { throw new Error('No page is open.'); }) });
    const res = await previewToolHandlers(ops).read({});
    expect(res).toEqual({ content: [{ type: 'text', text: 'No page is open.' }], isError: true });
  });

  it('needs exactly one click target', async () => {
    const ops = fakeOps();
    const run = previewToolHandlers(ops);
    expect(await run.click({})).toMatchObject({ isError: true, content: [{ text: 'Give one of: selector, text.' }] });
    expect(await run.click({ selector: '#a', text: 'Save' })).toMatchObject({ isError: true, content: [{ text: 'Give only one of: selector, text.' }] });
    expect(await run.click({ selector: '  ', text: 'Save' })).toMatchObject({ content: [{ text: 'Clicked <button> "save".' }] });
    expect(ops.click).toHaveBeenCalledTimes(1);
    expect(ops.click).toHaveBeenCalledWith({ selector: '  ', text: 'Save' }, { dialogs: undefined });
    await run.click({ text: 'Delete', dialogs: 'dismiss' });
    expect(ops.click).toHaveBeenLastCalledWith({ selector: undefined, text: 'Delete' }, { dialogs: 'dismiss' });
  });

  it('needs exactly one field target for typing and passes options', async () => {
    const ops = fakeOps();
    const run = previewToolHandlers(ops);
    expect(await run.type({ text: 'x' })).toMatchObject({ isError: true });
    await run.type({ label: 'Email', text: 'a@b.c', submit: true });
    expect(ops.type).toHaveBeenCalledWith({ selector: undefined, label: 'Email' }, 'a@b.c', { clear: undefined, submit: true, dialogs: undefined });
  });

  it('passes log options through', async () => {
    const ops = fakeOps();
    await previewToolHandlers(ops).logs({ errorsOnly: true });
    expect(ops.logs).toHaveBeenCalledWith({ errorsOnly: true, all: undefined });
  });
});

describe('tool names', () => {
  it('auto-allows looking but not acting', () => {
    expect(GROVE_PREVIEW_READ_TOOL_NAMES).toEqual([
      'mcp__grove-preview__preview_open',
      'mcp__grove-preview__preview_screenshot',
      'mcp__grove-preview__preview_read',
      'mcp__grove-preview__preview_logs',
    ]);
    for (const name of GROVE_PREVIEW_ACTION_TOOL_NAMES) {
      expect(GROVE_PREVIEW_READ_TOOL_NAMES as readonly string[]).not.toContain(name);
    }
  });
});
