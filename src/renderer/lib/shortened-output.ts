import type { OutputShortened } from '../../shared/types.js';
import { formatTokens } from './context-usage.js';

/** "a", "a and b", "a, b and c". */
function listOf(words: string[]): string {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** The Thread tab's line under a command whose output Grove shortened for
 *  the agent (the Shorten command output setting). */
export function shortenedNote(s: OutputShortened): string {
  const what = s.families.length > 0 ? `${listOf(s.families)} output` : 'output';
  return `The agent got a shorter version of this ${what}, about ${formatTokens(s.savedTokens)} tokens fewer. It can read the full output if it needs to.`;
}
