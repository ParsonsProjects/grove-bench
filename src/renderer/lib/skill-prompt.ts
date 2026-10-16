export interface SkillPromptOpts {
  name: string;
  description: string;
  scope: 'project' | 'user';
  /** Optional draft notes for the instruction body — the agent fleshes them out. */
  notes?: string;
}

/**
 * Build the first message of a thread started to have its agent author a
 * skill (startSkillThread). Provider-neutral on purpose: every agent knows
 * its own packaged-skill format better than Grove does (frontmatter
 * extensions, resource files), so beyond a Claude Code example the format is
 * left to the agent. A project skill's thread has a branch of its own; a user
 * skill's runs in the project folder, which it should leave alone.
 */
export function buildCreateSkillPrompt(opts: SkillPromptOpts): string {
  const location = opts.scope === 'project'
    ? "inside this repository. This thread's branch is only for this skill, so change nothing else"
    : "in your user-level skills location, so it applies across repositories. Don't change this repository's files";
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
