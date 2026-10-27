/**
 * The line that asks an agent to use a skill, first in a message: written
 * the same for every agent (each finds the skill in its own folders), by a
 * skill picked in the new thread panel and by a skill's run or schedule.
 */

/** The line itself. */
export function skillLine(skill: string): string {
  return `Use the \`${skill}\` skill for this task.`;
}

/** A skill line at the start of a message, with the space after it. Also
 *  matches the shorter line a run with no note sends ("Use the `x` skill."). */
const SKILL_LINE = /^Use the `([^`\n]+)` skill(?: for this task)?\.[ \t]*(?:\r?\n|$)\s*/;

/** The skill a message starts by asking for, and the rest of it. */
export function splitSkillLine(text: string): { skill: string; rest: string } | null {
  const match = text.match(SKILL_LINE);
  return match ? { skill: match[1], rest: text.slice(match[0].length) } : null;
}

/** The message starting by asking for `skill` (null: for none), keeping the
 *  rest. A skill already asked for is replaced, not stacked. */
export function withSkill(text: string, skill: string | null): string {
  const rest = splitSkillLine(text)?.rest ?? text;
  return skill ? `${skillLine(skill)}\n\n${rest}` : rest;
}

/** How the first message of a thread started to write a skill (Ask agent)
 *  begins. */
export const CREATE_SKILL_LEAD = 'Create a new agent skill named';

/** Whether a message is one Grove wrote to run or write a skill, rather
 *  than one the user typed: the run of a skill (by hand or on a schedule,
 *  with or without a note) or Ask agent's. */
export function isSkillPrompt(text: string): boolean {
  return splitSkillLine(text) !== null || text.startsWith(CREATE_SKILL_LEAD);
}
