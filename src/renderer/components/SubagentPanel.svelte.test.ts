import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

// MarkdownBlock calls DOMPurify.addHook at module load, and DOMPurify's
// default export resolves to a factory in this environment.
vi.mock('dompurify', () => ({
  default: { addHook: () => {}, sanitize: (html: string) => html },
}));

import OutputPanel from './OutputPanel.svelte';
import SubagentPanel from './SubagentPanel.svelte';
import { messageStore, type ChatMessage } from '../stores/messages.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { subagentPanelStore } from '../stores/subagentPanel.svelte.js';
import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';
import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';

const SID = 'subagent-session';

// The panel slides in and out. jsdom has no Web Animations, so each
// animation here finishes at once.
const realAnimate = Element.prototype.animate;

const agentCall: ChatMessage = {
  kind: 'tool_call', id: 'm1', toolName: 'Agent', toolUseId: 'tu-agent', uuid: 'a1', pending: false,
  toolInput: { description: 'Find what fires the burst', subagent_type: 'Explore', prompt: 'Look for the scheduler' },
  result: 'The burst comes from the 11:00 cron job.',
};
const subagentThread: ChatMessage[] = [
  { kind: 'tool_call', id: 's1', toolName: 'Grep', toolInput: { pattern: 'cron' }, toolUseId: 'tu-grep', uuid: 'b1', pending: false, result: 'serverless.ts', parentToolUseId: 'tu-agent' },
  { kind: 'text', id: 's2', text: 'I sent the full report to your caller.', uuid: 'b2', parentToolUseId: 'tu-agent' },
];

beforeEach(() => {
  Element.prototype.animate = function () {
    const animation = { onfinish: null as null | (() => void), cancel() {}, currentTime: 0 };
    queueMicrotask(() => animation.onfinish?.());
    return animation as unknown as Animation;
  };
  store.activeSessionId = SID;
  messageStore.messagesBySession = {
    [SID]: [{ kind: 'user', id: 'u1', text: 'why the burst?' }, agentCall, ...subagentThread, { kind: 'text', id: 'm2', text: 'The cause is the cron job.', uuid: 'a2' }],
  };
  messageStore.viewModeBySession = { [SID]: 'focus' };
  backgroundTaskStore.tasksBySession = {};
  subagentPanelStore.close();
  markdownPreviewStore.close();
});

afterEach(() => {
  // Unmount first: the panel's outro still needs the animate stub.
  cleanup();
  Element.prototype.animate = realAnimate;
});

describe('the thread and a subagent', () => {
  it('shows the subagent as one line, and none of its messages, even in Focus', () => {
    const { getByRole, queryByText, getByText } = render(OutputPanel, { sessionId: SID });

    const line = getByRole('button', { name: /Find what fires the burst/ });
    expect(line).toHaveTextContent('Explore');
    expect(line).toHaveTextContent('1 call');
    expect(line).toHaveTextContent('done');
    expect(queryByText('I sent the full report to your caller.')).toBeNull();
    expect(getByText('The cause is the cron job.')).toBeInTheDocument();
  });

  it('opens the subagent\'s thread from its line', async () => {
    const { getByRole } = render(OutputPanel, { sessionId: SID });
    await fireEvent.click(getByRole('button', { name: /Find what fires the burst/ }));
    expect(subagentPanelStore.isShowing(SID, 'tu-agent')).toBe(true);
  });

  it('shows a background subagent as running while its task is', () => {
    backgroundTaskStore.tasksBySession = {
      [SID]: { bg: { taskId: 'bg', toolUseId: 'tu-agent', description: '', status: 'running', totalTokens: 0, toolUses: 0, durationMs: 0 } },
    };
    const { getByRole } = render(OutputPanel, { sessionId: SID });
    const line = getByRole('button', { name: /Find what fires the burst/ });
    expect(line).not.toHaveTextContent('done');
    expect(line).toHaveTextContent('running');
  });
});

describe('SubagentPanel', () => {
  it('shows the subagent\'s prompt, tool calls and report in its own view', async () => {
    subagentPanelStore.setViewMode('detailed');
    subagentPanelStore.show(SID, 'tu-agent');
    const { getByRole, getByText, getByLabelText } = render(SubagentPanel);
    await tick();

    const panel = getByRole('complementary', { name: 'Subagent thread' });
    expect(panel).toHaveTextContent('Find what fires the burst');
    expect(panel).toHaveTextContent('Subagent · Explore');
    expect(getByText('Look for the scheduler')).toBeInTheDocument();
    expect(getByText('I sent the full report to your caller.')).toBeInTheDocument();
    expect(panel).toHaveTextContent('Grep');
    // Not the conversation's own messages.
    expect(panel).not.toHaveTextContent('The cause is the cron job.');
    // Its view picker, without the dot that sets it apart from the Thread tab's name.
    expect(getByLabelText(/Subagent view: Detailed/).textContent?.trim()).toBe('Detailed');
  });

  const pressEsc = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

  it('closes on Esc, but leaves Esc to the Focus panel open over it', async () => {
    subagentPanelStore.show(SID, 'tu-agent');
    render(SubagentPanel);
    await tick();

    // The Focus panel's own handler closes it as the key reaches the window.
    markdownPreviewStore.show('report', 'Agent response');
    const closeFocus = () => markdownPreviewStore.close();
    window.addEventListener('keydown', closeFocus, { once: true });
    pressEsc();
    expect(markdownPreviewStore.open).toBe(false);
    expect(subagentPanelStore.open).toBe(true);

    pressEsc();
    expect(subagentPanelStore.open).toBe(false);
  });

  it('leaves Esc to a dialog or menu open in it', async () => {
    subagentPanelStore.show(SID, 'tu-agent');
    render(SubagentPanel);
    await tick();

    // As bits-ui does for its dialogs and menus.
    const handled = (e: Event) => e.preventDefault();
    document.addEventListener('keydown', handled, { once: true });
    pressEsc();
    expect(subagentPanelStore.open).toBe(true);
  });

  it('closes when its conversation is no longer the open one', async () => {
    subagentPanelStore.show(SID, 'tu-agent');
    render(SubagentPanel);
    await tick();

    store.activeSessionId = 'another';
    await tick();
    expect(subagentPanelStore.open).toBe(false);
  });

  it('says what a running subagent is doing when the view hides its calls', async () => {
    messageStore.messagesBySession = {
      [SID]: [
        { ...agentCall, pending: true, result: undefined } as ChatMessage,
        { kind: 'tool_call', id: 's1', toolName: 'Bash', toolInput: { command: 'node runs.mjs' }, toolUseId: 'tu-bash', uuid: 'b1', pending: true, parentToolUseId: 'tu-agent' },
      ],
    };
    subagentPanelStore.setViewMode('focus');
    subagentPanelStore.show(SID, 'tu-agent');
    const { getByText } = render(SubagentPanel);
    await tick();
    expect(getByText('Working...').parentElement).toHaveTextContent('Working... Bash node runs.mjs');
  });

  it('falls back to the result for a subagent recorded without its thread', async () => {
    messageStore.messagesBySession = { [SID]: [agentCall] };
    subagentPanelStore.show(SID, 'tu-agent');
    const { getByText } = render(SubagentPanel);
    await tick();
    expect(getByText('The burst comes from the 11:00 cron job.')).toBeInTheDocument();
  });
});
