import { draftStore } from '../stores/draft.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import { buildCreateSkillPrompt, type SkillPromptOpts } from './skill-prompt.js';

/**
 * Hand writing a skill to an agent in a new thread, so the follow-up
 * questions have a place of their own instead of landing in the thread it
 * was asked from. A project skill gets a new branch, so it goes up for review
 * as its own pull request. A user skill lives outside the project, so its
 * thread runs in the project folder and needs no worktree. The new thread
 * runs on the agent (and model) of the thread it was asked from, since each
 * agent has its own skills.
 */
export function startSkillThread(fromSessionId: string, opts: SkillPromptOpts): Promise<boolean> {
  const from = store.sessions.find((s) => s.id === fromSessionId);
  if (!from) return Promise.resolve(false);
  return draftStore.startThread({
    repoPath: from.repoPath,
    // A thread with no agent type runs the default agent; naming it keeps
    // the model, which startThread drops for any other agent.
    agentId: from.agentType ?? agentsStore.defaultId ?? undefined,
    model: messageStore.getModel(fromSessionId),
    start: opts.scope === 'project'
      ? { kind: 'new', branchName: '', baseBranch: '' }
      : { kind: 'folder' },
    text: buildCreateSkillPrompt(opts),
  });
}
