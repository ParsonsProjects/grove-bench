import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';

// The default export is a factory in this environment; build a real
// sanitizer on jsdom's window so highlight.js spans survive it.
vi.mock('dompurify', async () => {
  const actual = await vi.importActual<{ default: (w: Window) => unknown }>('dompurify');
  return { default: actual.default(window) };
});

import PermissionBlock from './PermissionBlock.svelte';
import { settingsStore } from '../stores/settings.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';

const props = { sessionId: 's1', requestId: 'r1', toolName: 'Bash', toolInput: { command: 'npm install zod' } };

afterEach(() => {
  cleanup();
  settingsStore.current = { ...settingsStore.current, groveCharacters: true };
});

describe('PermissionBlock commands', () => {
  it('shows the agent\'s description of a command it sent no text for', () => {
    render(PermissionBlock, {
      sessionId: 's1', requestId: 'r1', toolName: 'execute', toolInput: {}, resolved: false,
      toolCategory: 'bash', toolView: { kind: 'other', summary: 'rm -rf build' },
    });
    expect(screen.getByText('rm -rf build')).toBeInTheDocument();
    expect(screen.getByText(/As the agent describes it/)).toBeInTheDocument();
  });

  it("names what any agent's read or search is about, from its view", () => {
    render(PermissionBlock, {
      sessionId: 's1', requestId: 'r1', toolName: 'read', toolInput: {}, resolved: false,
      toolCategory: 'read', toolView: { kind: 'read', path: 'docs/notes.md' },
    });
    expect(screen.getByText('docs/notes.md')).toBeInTheDocument();
  });
});

describe('PermissionBlock grove character', () => {
  it('waits with a question mark until answered', () => {
    render(PermissionBlock, { ...props, resolved: false });
    expect(screen.getByRole('img', { name: 'Waiting for you' })).toBeInTheDocument();
  });

  it('shows the outcome once answered', () => {
    render(PermissionBlock, { ...props, resolved: true, decision: 'allow' });
    expect(screen.getByRole('img', { name: 'Allowed' })).toBeInTheDocument();
    cleanup();
    render(PermissionBlock, { ...props, resolved: true, decision: 'deny' });
    expect(screen.getByRole('img', { name: 'Denied' })).toBeInTheDocument();
  });

  it('is left out when grove characters are off', () => {
    settingsStore.current = { ...settingsStore.current, groveCharacters: false };
    render(PermissionBlock, { ...props, resolved: false });
    expect(screen.queryByRole('img', { name: 'Waiting for you' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
  });
});

describe('PermissionBlock plan approval', () => {
  const plan = {
    sessionId: 's1', requestId: 'r2', toolName: 'ExitPlanMode', toolInput: { plan: '1. Do it' },
    isPlanExecution: true, planText: '1. Do it', resolved: false,
  };

  it('offers three plainly named choices, each saying what it does', () => {
    render(PermissionBlock, plan);
    for (const name of ['Approve', 'Approve and start fresh…', 'Keep planning']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('title');
    }
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveAttribute('title', expect.stringContaining('Edit mode'));
    expect(screen.queryByRole('button', { name: /Execute/ })).toBeNull();
  });

  it('asks before clearing the conversation to start fresh', async () => {
    const clearAndSend = vi.spyOn(messageStore, 'clearAndSend').mockImplementation(() => {});
    const resolve = vi.spyOn(messageStore, 'resolvePermission').mockResolvedValue(true);
    render(PermissionBlock, plan);

    await fireEvent.click(screen.getByRole('button', { name: 'Approve and start fresh…' }));
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Your files stay as they are');

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Approve and start fresh…' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Clear and start' }));
    await vi.waitFor(() => expect(clearAndSend).toHaveBeenCalledWith('s1', expect.stringContaining('1. Do it')));
    clearAndSend.mockRestore();
    resolve.mockRestore();
  });
});

describe('PermissionBlock timeout', () => {
  it('says nobody answered instead of a plain "denied"', () => {
    render(PermissionBlock, { ...props, resolved: true, decision: 'deny', timedOut: true });
    expect(screen.getByText('no answer after 30 minutes, so it was denied')).toBeInTheDocument();
  });
});

describe('PermissionBlock always-allow button', () => {
  it('says it covers every command, not just this one', () => {
    render(PermissionBlock, { ...props, toolCategory: 'bash', resolved: false });
    const button = screen.getByRole('button', { name: 'Allow all commands' });
    expect(button).toHaveAttribute('title', expect.stringContaining('every shell command'));
    expect(screen.queryByRole('button', { name: 'Always Allow' })).toBeNull();
  });
});

describe('PermissionBlock edit preview', () => {
  it('colours the proposed change by the file\'s language', async () => {
    const { container } = render(PermissionBlock, {
      sessionId: 's1', requestId: 'r3', toolName: 'Edit', resolved: false, toolCategory: 'edit',
      toolInput: { file_path: 'src/app.ts', old_string: 'const port = 1;', new_string: 'const port = 2;' },
      toolView: { kind: 'edit', path: 'src/app.ts', edits: [{ oldText: 'const port = 1;', newText: 'const port = 2;' }] },
    });
    expect(container).toHaveTextContent('const port = 2;');
    await vi.waitFor(() => expect(container.querySelector('.hljs-keyword')).toHaveTextContent('const'));
  });

  it('holds a large write back until asked, and can be answered either way', async () => {
    const { container } = render(PermissionBlock, {
      sessionId: 's1', requestId: 'r4', toolName: 'Write', resolved: false, toolCategory: 'edit',
      toolInput: { file_path: 'dist/app.min.js', content: 'x'.repeat(150_000) + 'END' },
    });
    expect(screen.getByText(/Large edit \(1 line, 150,003 characters of text\)/)).toBeInTheDocument();
    expect(container).not.toHaveTextContent('END');
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Show edit to dist/app.min.js' }));
    expect(container).toHaveTextContent('END');
  });

  it('offers side-by-side for a large edit once it is shown', async () => {
    render(PermissionBlock, {
      sessionId: 's1', requestId: 'r5', toolName: 'Edit', resolved: false, toolCategory: 'edit',
      toolInput: {}, toolView: { kind: 'edit', path: 'src/data.ts', edits: [{ oldText: 'a', newText: 'x'.repeat(150_001) }] },
    });
    expect(screen.queryByRole('button', { name: 'side-by-side' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Show edit to src/data.ts' }));
    expect(screen.getByRole('button', { name: 'side-by-side' })).toBeInTheDocument();
  });
});
