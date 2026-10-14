import { describe, it, expect, vi } from 'vitest';
import { previewToolHandlers, claudePreviewServer, CLAUDE_PREVIEW_INSTRUCTIONS } from './preview-mcp-server.js';
import { isAutoAllowedGroveTool } from './grove-tools.js';
import { previewServer } from './grove-tools.js';
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
    for (const tool of ['preview_open', 'preview_screenshot', 'preview_read', 'preview_logs']) {
      expect(isAutoAllowedGroveTool(`mcp__grove-preview__${tool}`, new Set(['grove-preview'])), tool).toBe(true);
    }
    for (const tool of ['preview_click', 'preview_type']) {
      expect(isAutoAllowedGroveTool(`mcp__grove-preview__${tool}`, new Set(['grove-preview'])), tool).toBe(false);
    }
  });
});

describe('claudePreviewServer', () => {
  it('adds the Claude Code-only advice to the shared instructions', () => {
    const shared = previewServer(fakeOps());
    const claude = claudePreviewServer(fakeOps());
    expect(claude.instructions).toBe(`${shared.instructions} ${CLAUDE_PREVIEW_INSTRUCTIONS}`);
    expect(claude.tools.map((t) => t.name)).toEqual(shared.tools.map((t) => t.name));
    expect(claude.alwaysLoad).toBe(true);
  });

  it('keeps Claude Code tool names out of what other agents are told', () => {
    // previewServer is also served to ACP agents, which have no run skill or Artifact tool.
    expect(previewServer(fakeOps()).instructions).not.toMatch(/run skill|Artifact/);
  });
});
