import { CREATE_SKILL_LEAD } from '../../shared/skill-line.js';

export interface SkillPromptOpts {
  name: string;
  description: string;
  scope: 'project' | 'user';
  /** Optional draft notes for the instruction body — the agent fleshes them out. */
  notes?: string;
}

/**
 * Build the first message of a thread started to have its agent author a
 * skill (startSkillThread). The skill goes in the shared `.agents/skills`
 * folder so every agent can use it; Claude Code sees it through a link
 * Grove adds when a thread starts or the Skills drawer opens. A project
 * skill's thread has a branch of its own (`ownBranch`) unless the project
 * has no git; a user skill's runs in the project folder, which it should
 * leave alone.
 */
export function buildCreateSkillPrompt(opts: SkillPromptOpts, ownBranch = opts.scope === 'project'): string {
  const file = `${opts.scope === 'user' ? '~/' : ''}.agents/skills/${opts.name}/SKILL.md`;
  const location = opts.scope === 'user'
    ? `as \`${file}\` in your home folder, so it applies across repositories. Don't change this repository's files`
    : ownBranch
      ? `as \`${file}\` in this repository. This thread's branch is only for this skill, so change nothing else`
      : `as \`${file}\` in this project folder. Change nothing else`;
  const lines = [
    `${CREATE_SKILL_LEAD} \`${opts.name}\` ${location}.`,
    '',
    `Trigger description (when the skill should be used): ${opts.description}`,
  ];
  if (opts.notes?.trim()) {
    lines.push('', 'Draft notes for the instruction body — expand these into proper instructions:', opts.notes.trim());
  }
  lines.push(
    '',
    "Use the Agent Skills format that coding agents share: YAML frontmatter with `name` and `description`, then the markdown instruction body, with any scripts or reference files in the skill's folder. Keep it to what every agent understands, as any of them may use it, and keep the body focused and actionable. Then reply with the path of the file you created.",
  );
  return lines.join('\n');
}
