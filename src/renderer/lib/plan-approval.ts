/**
 * Wording for the plan-approval prompt's choices. The agent can suggest
 * permission changes to apply with the approval (usually a mode switch);
 * what they are is only known when the prompt arrives, so the button that
 * applies them is labelled from the suggestions themselves.
 */

const MODE_CHOICES: Record<string, { label: string; title: string }> = {
  acceptEdits: {
    label: 'Approve, auto-accept edits',
    title: 'Approve the plan and switch to Edit mode: file edits in the worktree are applied without asking, commands still ask.',
  },
  default: {
    label: 'Approve, ask before edits',
    title: 'Approve the plan and switch to Ask mode: the agent checks with you before each edit or command.',
  },
};

/** The choice that applies the agent's suggested permission changes, or null
 *  when it suggested none (the button is then left out). */
export function suggestedApproval(suggestions: readonly unknown[] | undefined): { label: string; title: string } | null {
  if (!suggestions || suggestions.length === 0) return null;
  const modes = suggestions.flatMap((s) => {
    const u = s as { type?: unknown; mode?: unknown } | null;
    return u && u.type === 'setMode' && typeof u.mode === 'string' ? [u.mode] : [];
  });
  const mode = modes[modes.length - 1];
  if (mode && MODE_CHOICES[mode]) return MODE_CHOICES[mode];
  if (mode) return { label: `Approve in ${mode} mode`, title: `Approve the plan and switch to ${mode} mode.` };
  return { label: 'Approve with suggested permissions', title: 'Approve the plan and apply the permission changes the agent suggested.' };
}

export const PLAN_CHOICES = {
  approve: {
    label: 'Approve',
    title: 'Approve the plan so the agent starts making the changes.',
  },
  keepPlanning: {
    label: 'Keep planning',
    title: 'Don\'t start yet. Type below to say what to change in the plan.',
  },
  fresh: {
    label: 'Approve in a fresh conversation',
    title: 'Clear this conversation\'s messages and start again with only the plan, so the agent has its whole context for the work. Your files are not changed.',
  },
} as const;
