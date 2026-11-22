import { threadCutOff } from './cut-off.js';
import type { SessionStatus } from '../../shared/types.js';
import { messageStore } from '../stores/messages.svelte.js';
import { sessionPreviewStore } from '../stores/sessionPreviews.svelte.js';
import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';
import { backgroundAgentRunning } from './thread-working.js';
import {
  sessionSubtitle,
  pendingPermissionTool,
  pendingPermissionView,
  lastTextSnippet,
  firstPromptSnippet,
  type SessionSubtitle,
} from './session-subtitle.js';

/**
 * The line under a thread's name, in its sidebar row and on its board card:
 * waiting-reason > live activity > background agents > last/first message.
 */
export function threadSubtitle(session: { id: string; status: SessionStatus }): SessionSubtitle | null {
  const msgs = messageStore.getMessages(session.id);
  const loaded = msgs.length > 0;
  const preview = sessionPreviewStore.get(session.id);
  const isRunning = messageStore.getIsRunning(session.id);
  const pendingTool = loaded ? pendingPermissionTool(msgs) : null;
  const backgroundAgents = backgroundAgentRunning(session) ? backgroundTaskStore.runningAgents(session.id).map((t) => t.description) : [];
  // Past messages only show when nothing live does, so skip that work while
  // the agent runs (its reply grows with every update) or waits on you.
  const quiet = !isRunning && !pendingTool && backgroundAgents.length === 0;
  const lastText = quiet ? ((loaded ? lastTextSnippet(msgs) : null) ?? (preview?.lastText || null)) : null;
  const firstPrompt = quiet && !lastText ? ((loaded ? firstPromptSnippet(msgs) : null) ?? (preview?.firstPrompt || null)) : null;
  const pendingToolView = pendingTool ? pendingPermissionView(msgs) : undefined;
  const cutOff = !isRunning && threadCutOff(session.id) !== null;
  return sessionSubtitle({ isRunning, activity: messageStore.getActivity(session.id), pendingTool, pendingToolView, cutOff, backgroundAgents, lastText, firstPrompt });
}

/** The subtitle's colour: blue while working, amber while it waits on you. */
export const SUBTITLE_TONE_CLASS: Record<SessionSubtitle['tone'], string> = {
  working: 'text-status-working',
  waiting: 'text-status-attention',
  context: 'text-muted-foreground',
};
