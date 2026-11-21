/**
 * Claude Code's side of the "Shorten command output" setting: a PostToolUse
 * hook that hands the model a shorter version of what a successful Bash
 * command printed (output-filter.ts says how), and keeps the full output for
 * the Thread tab.
 *
 * The hook returns its version in `updatedToolOutput`, which the CLI takes
 * only when it has the Bash tool's own output shape: anything else it logs
 * and drops, keeping the original. So the replacement is the tool's
 * response with stdout and stderr swapped and every other field as it was.
 * A failing command never comes here: it goes to PostToolUseFailure, which
 * can add context but not change the output.
 *
 * Before the model gets the short version, the full output is saved in the
 * thread's attachments folder, where Grove lets the agent read without
 * asking (tool-policy.ts), and the short version ends with its path. Saving
 * fails: the output is left as it was.
 *
 * Other PostToolUse hooks (the user's, a project's) run beside this one on
 * the same output, and the last rewrite wins. So the Thread tab's note and
 * the savings count only once the result is seen to have Grove's version
 * in it: its footer, which names a file only Grove writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import type { OutputShortened } from '../../shared/types.js';
import { COMMAND_OUTPUT_FOLDER } from '../../shared/attachments.js';
import { estimateTokens, shortenCommandOutput } from '../output-filter.js';
import { isRecord } from '../persisted-state.js';
import { logger } from '../logger.js';

/** What the model was told after a shortened output. */
export function shortenedFooter(file: string): string {
  return `[Grove Bench shortened this output. The full output is in ${file}]`;
}

/** Shortened outputs kept for results not read yet. One the CLI never
 *  sends a result for (the turn was stopped) would otherwise stay. */
const MAX_WAITING = 100;

interface Shortened {
  stdout: string;
  stderr: string;
  /** What the model got in their place. */
  modelStdout: string;
  modelStderr: string;
  /** The last line of modelStdout. */
  footer: string;
  note: OutputShortened;
}

/** The outputs a query's hook shortened, until their results are read,
 *  and the tokens saved since the last result. */
export class ShortenedOutputs {
  private readonly byToolUse = new Map<string, Shortened>();
  private savedSinceResult = 0;

  add(toolUseId: string, shortened: Shortened): void {
    this.byToolUse.delete(toolUseId);
    this.byToolUse.set(toolUseId, shortened);
    if (this.byToolUse.size > MAX_WAITING) this.byToolUse.delete(this.byToolUse.keys().next().value!);
  }

  /** A tool result's content with the full output back in place of what
   *  the model got, and the note, for a result the hook shortened: null
   *  when the model didn't get Grove's version after all (another hook's
   *  won). Once for each result; counts the savings. */
  takeResult(toolUseId: string, content: string): { content: string; note: OutputShortened } | null {
    const shortened = this.byToolUse.get(toolUseId);
    if (!shortened) return null;
    this.byToolUse.delete(toolUseId);
    const full = fullContent(content, shortened);
    if (full === null) return null;
    this.savedSinceResult += shortened.note.savedTokens;
    return { content: full, note: shortened.note };
  }

  /** The tokens saved since the last call, for the turn's result. */
  takeSavedTokens(): number {
    const saved = this.savedSinceResult;
    this.savedSinceResult = 0;
    return saved;
  }
}

/** The full output, joined the way Claude Code shows the model a command's. */
function joinOutput(stdout: string, stderr: string): string {
  return [stdout.trimEnd(), stderr.trimEnd()].filter((s) => s !== '').join('\n');
}

/**
 * The result content Claude Code made, with the full output back in place
 * of the short one: anything it added around them (a note that the working
 * directory was reset) stays. Null when it hasn't Grove's version in it.
 * The short stdout ends at the footer; short stderr is looked for after it,
 * trimmed, as Claude Code may trim it. Where that can't be found, the full
 * stderr goes straight after stdout in its place.
 */
function fullContent(content: string, s: Shortened): string | null {
  const footerAt = content.lastIndexOf(s.footer);
  if (footerAt < 0) return null;
  const outEnd = footerAt + s.footer.length;
  const shownOut = s.modelStdout.trim();
  const outAt = content.lastIndexOf(shownOut, footerAt);
  const outStart = outAt >= 0 && outAt + shownOut.length === outEnd ? outAt : 0;
  const before = content.slice(0, outStart);
  let after = content.slice(outEnd);
  const shownErr = s.modelStderr.trim();
  const fullErr = s.stderr.trim();
  const errAt = shownErr ? after.indexOf(shownErr) : -1;
  if (errAt >= 0) after = after.slice(0, errAt) + fullErr + after.slice(errAt + shownErr.length);
  else if (fullErr) after = `\n${fullErr}${shownErr ? '' : after}`;
  return before + s.stdout.trimEnd() + after;
}

/** The file `toolUseId`'s full output is saved as. */
function outputFile(folder: string, toolUseId: string): string {
  return path.join(folder, `${toolUseId.replace(/[^A-Za-z0-9_-]/g, '_') || 'output'}.txt`);
}

/** Save `text` as `file`. False if it couldn't be saved. */
async function saveFullOutput(file: string, text: string): Promise<boolean> {
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, text, 'utf-8');
    return true;
  } catch (err) {
    logger.warn(`[shorten-output] could not save the full output as ${file}:`, err);
    return false;
  }
}

/** The hook, saving full outputs in `attachmentsDir`. */
export function shortenOutputHook(shortened: ShortenedOutputs, attachmentsDir: string): HookCallback {
  const folder = path.join(attachmentsDir, COMMAND_OUTPUT_FOLDER);
  return async (input) => {
    if (input.hook_event_name !== 'PostToolUse' || input.tool_name !== 'Bash') return {};
    const response = input.tool_response;
    const command = isRecord(input.tool_input) ? input.tool_input.command : undefined;
    if (!isRecord(response) || typeof command !== 'string') return {};
    const { stdout, stderr } = response;
    if (typeof stdout !== 'string' || typeof stderr !== 'string') return {};
    // Left as Claude Code made it: a command stopped partway or still
    // running in the background, an image, or output too large to show,
    // which Claude Code has saved and shows the start of itself.
    if (response.interrupted === true || response.isImage === true || response.backgroundTaskId !== undefined
      || response.persistedOutputPath !== undefined || response.rawOutputPath !== undefined
      || response.structuredContent !== undefined) return {};

    // The footer counts against the savings, so it's known before the
    // rules decide whether shortening is worth it, and before anything is
    // saved.
    const file = outputFile(folder, input.tool_use_id);
    const footer = shortenedFooter(file);
    const short = shortenCommandOutput(command, stdout, stderr, footer.length + 1);
    if (!short || !await saveFullOutput(file, joinOutput(stdout, stderr))) return {};
    const modelStdout = `${short.stdout}${short.stdout ? '\n' : ''}${footer}`;
    const fullChars = stdout.length + stderr.length;
    const modelChars = modelStdout.length + short.stderr.length;

    shortened.add(input.tool_use_id, {
      stdout,
      stderr,
      modelStdout,
      modelStderr: short.stderr,
      footer,
      note: { families: short.families, fullChars, modelChars, savedTokens: estimateTokens(fullChars - modelChars), file },
    });
    return {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        updatedToolOutput: { ...response, stdout: modelStdout, stderr: short.stderr },
      },
    };
  };
}
