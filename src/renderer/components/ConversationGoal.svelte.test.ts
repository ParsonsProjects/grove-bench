import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/svelte';

import ConversationGoal from './ConversationGoal.svelte';
import { goalStore } from '../stores/goals.svelte.js';
import { messageStore, type ChatMessage } from '../stores/messages.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';
import type { ConversationGoal as Goal } from '../../shared/types.js';

const SID = 'goal1';

const REPLIED: ChatMessage[] = [
  { kind: 'user', id: 'u1', text: 'Add a dark mode toggle' } as ChatMessage,
  { kind: 'text', id: 't1', text: 'Added it.', uuid: 'a1' },
];

function goal(over: Partial<Goal> = {}): Goal {
  return { text: 'Add a dark mode toggle', source: 'auto', hidden: false, ...over };
}

async function renderWith(saved: Goal, messages: ChatMessage[] = REPLIED) {
  messageStore.messagesBySession = { [SID]: messages };
  mockGroveBench.getConversationGoal.mockResolvedValue(saved);
  render(ConversationGoal, { props: { sessionId: SID } });
  await waitFor(() => expect(goalStore.isLoaded(SID)).toBe(true));
}

beforeEach(() => {
  goalStore.goals = {};
  goalStore.generating = {};
  goalStore.errors = {};
  messageStore.messagesBySession = {};
  messageStore.isRunning = {};
  settingsStore.current.showConversationGoal = true;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ConversationGoal', () => {
  it('shows the saved goal', async () => {
    await renderWith(goal());
    expect(screen.getByTestId('conversation-goal')).toBeInTheDocument();
    expect(screen.getByText('Add a dark mode toggle')).toBeInTheDocument();
  });

  it('shows nothing when goals are off or the bar was hidden', async () => {
    settingsStore.current.showConversationGoal = false;
    await renderWith(goal());
    expect(screen.queryByTestId('conversation-goal')).not.toBeInTheDocument();
    cleanup();

    settingsStore.current.showConversationGoal = true;
    goalStore.goals = {};
    await renderWith(goal({ hidden: true }));
    expect(screen.queryByTestId('conversation-goal')).not.toBeInTheDocument();
  });

  it('waits for the first turn to end before offering an empty goal', async () => {
    messageStore.isRunning = { [SID]: true };
    await renderWith(goal({ text: null, source: null }));
    expect(screen.queryByTestId('conversation-goal')).not.toBeInTheDocument();

    messageStore.isRunning = { [SID]: false };
    expect(await screen.findByText('No goal yet')).toBeInTheDocument();
  });

  it('treats a conversation main has no entry for yet as having no goal', async () => {
    // A new worktree conversation: its pane asks before main has saved it.
    await renderWith(null as unknown as Goal);
    expect(goalStore.get(SID)).toEqual({ text: null, source: null, hidden: false });
    expect(await screen.findByText('No goal yet')).toBeInTheDocument();
  });

  it('shows nothing before the agent has replied', async () => {
    await renderWith(goal({ text: null, source: null }), [REPLIED[0]]);
    expect(screen.queryByTestId('conversation-goal')).not.toBeInTheDocument();
  });

  it('saves an edit on Enter, and Escape cancels', async () => {
    mockGroveBench.setConversationGoal.mockResolvedValue(goal({ text: 'Ship dark mode', source: 'user' }));
    await renderWith(goal());

    await fireEvent.click(screen.getByLabelText('Edit the goal'));
    const input = screen.getByLabelText('Conversation goal') as HTMLInputElement;
    expect(input.value).toBe('Add a dark mode toggle');
    await fireEvent.input(input, { target: { value: 'Ship dark mode' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockGroveBench.setConversationGoal).toHaveBeenCalledWith(SID, 'Ship dark mode');
    expect(await screen.findByText('Ship dark mode')).toBeInTheDocument();

    await fireEvent.click(screen.getByLabelText('Edit the goal'));
    const again = screen.getByLabelText('Conversation goal');
    await fireEvent.input(again, { target: { value: 'Something else' } });
    await fireEvent.keyDown(again, { key: 'Escape' });
    expect(mockGroveBench.setConversationGoal).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Ship dark mode')).toBeInTheDocument();
  });

  it('leaves Enter and Escape to an IME that is composing', async () => {
    await renderWith(goal());
    await fireEvent.click(screen.getByLabelText('Edit the goal'));
    const input = screen.getByLabelText('Conversation goal');
    await fireEvent.input(input, { target: { value: 'ダーク' } });
    await fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    await fireEvent.keyDown(input, { key: 'Escape', isComposing: true });

    expect(mockGroveBench.setConversationGoal).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Conversation goal')).toBeInTheDocument();
  });

  it('refreshes the goal, and says why when that fails', async () => {
    mockGroveBench.refreshConversationGoal.mockResolvedValueOnce(goal({ text: 'Ship dark mode for all pages' }));
    await renderWith(goal());

    await fireEvent.click(screen.getByLabelText('Refresh the goal'));
    expect(await screen.findByText('Ship dark mode for all pages')).toBeInTheDocument();

    mockGroveBench.refreshConversationGoal.mockRejectedValueOnce(
      new Error("Error invoking remote method 'session:refreshGoal': Error: model busy"),
    );
    await fireEvent.click(screen.getByLabelText('Refresh the goal'));
    expect(await screen.findByText('model busy')).toBeInTheDocument();
  });

  it('hides the bar for this conversation', async () => {
    mockGroveBench.setConversationGoalHidden.mockResolvedValue(goal({ hidden: true }));
    await renderWith(goal());

    await fireEvent.click(screen.getByLabelText('Hide the goal'));

    expect(mockGroveBench.setConversationGoalHidden).toHaveBeenCalledWith(SID, true);
    expect(screen.queryByTestId('conversation-goal')).not.toBeInTheDocument();
  });
});

describe('goalStore.autoGenerate', () => {
  it('asks main only while the conversation has never had a goal and its bar is open', async () => {
    goalStore.goals = { [SID]: goal({ source: 'user' }) };
    await goalStore.autoGenerate(SID);
    goalStore.goals = { [SID]: goal({ text: null, source: null, hidden: true }) };
    await goalStore.autoGenerate(SID);
    expect(mockGroveBench.autoConversationGoal).not.toHaveBeenCalled();

    goalStore.goals = { [SID]: goal({ text: null, source: null }) };
    mockGroveBench.autoConversationGoal.mockResolvedValue(goal());
    await goalStore.autoGenerate(SID);
    expect(mockGroveBench.autoConversationGoal).toHaveBeenCalledWith(SID);
    expect(goalStore.get(SID).text).toBe('Add a dark mode toggle');
    expect(goalStore.isGenerating(SID)).toBe(false);
  });

  it('shows the busy state only once main is actually writing one', async () => {
    vi.useFakeTimers();
    try {
      goalStore.goals = { [SID]: goal({ text: null, source: null }) };
      // Main skips at once: no flash.
      mockGroveBench.autoConversationGoal.mockResolvedValueOnce(null);
      await goalStore.autoGenerate(SID);
      expect(goalStore.isGenerating(SID)).toBe(false);

      // Main writes one: busy after a moment, done when it arrives.
      let finish!: (g: Goal) => void;
      mockGroveBench.autoConversationGoal.mockReturnValueOnce(new Promise((r) => { finish = r; }));
      const pending = goalStore.autoGenerate(SID);
      expect(goalStore.isGenerating(SID)).toBe(false);
      await vi.advanceTimersByTimeAsync(400);
      expect(goalStore.isGenerating(SID)).toBe(true);
      finish(goal());
      await pending;
      expect(goalStore.isGenerating(SID)).toBe(false);
      expect(goalStore.get(SID).text).toBe('Add a dark mode toggle');
    } finally {
      vi.useRealTimers();
    }
  });
});
