export interface SkillPromptOpts {
  name: string;
  description: string;
  scope: 'project' | 'user';
  /** Optional draft notes for the instruction body — the agent fleshes them out. */
  notes?: string;
}

/**
 * Build the conversation turn that asks the session's agent to author a skill
 * itself. Provider-neutral on purpose: every agent knows its own packaged-skill
 * format better than Grove does (frontmatter extensions, resource files), so
 * beyond a Claude Code example the format is left to the agent.
 */
export function buildCreateSkillPrompt(opts: SkillPromptOpts): string {
  const location = opts.scope === 'project'
    ? 'inside this repository, so it ships with this branch'
    : 'in your user-level skills location, so it applies across repositories';
  const lines = [
    `Create a new agent skill named \`${opts.name}\` ${location}.`,
    '',
    `Trigger description (when the skill should be used): ${opts.description}`,
  ];
  if (opts.notes?.trim()) {
    lines.push('', 'Draft notes for the instruction body — expand these into proper instructions:', opts.notes.trim());
  }
  lines.push(
    '',
    "Use your platform's packaged-skill conventions (for Claude Code: `.claude/skills/<name>/SKILL.md` with YAML frontmatter `name` and `description`, then the markdown instruction body). Keep the body focused and actionable, then reply with the path of the file you created.",
  );
  return lines.join('\n');
}
