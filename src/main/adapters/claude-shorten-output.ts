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
 */
import fs from 'node:fs';
import path from 'node:path';
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import type { OutputShortened } from '../../shared/types.js';
import { estimateTokens, shortenCommandOutput } from '../output-filter.js';
import { isRecord } from '../persisted-state.js';
import { logger } from '../logger.js';

/** The folder in a thread's attachments folder the full outputs go in. */
export const COMMAND_OUTPUT_FOLDER = 'command-output';

/** What the model was told after a shortened output. */
export function shortenedFooter(file: string): string {
  return `[Grove Bench shortened this output. The full output is in ${file}]`;
}

interface Shortened {
  stdout: string;
  stderr: string;
  /** What the model got in their place. */
  modelStdout: string;
  modelStderr: string;
  note: OutputShortened;
}

/** The outputs a query's hook shortened, until their results are read,
 *  and the tokens saved since the last result. */
export class ShortenedOutputs {
  private readonly byToolUse = new Map<string, Shortened>();
  private savedSinceResult = 0;

  add(toolUseId: string, shortened: Shortened): void {
    this.byToolUse.set(toolUseId, shortened);
    this.savedSinceResult += shortened.note.savedTokens;
  }

  /** A tool result's content with the full output back in place of what
   *  the model got, and the note, for a result the hook shortened. Once
   *  for each result. */
  takeResult(toolUseId: string, content: string): { content: string; note: OutputShortened } | null {
    const shortened = this.byToolUse.get(toolUseId);
    if (!shortened) return null;
    this.byToolUse.delete(toolUseId);
    return { content: fullContent(content, shortened), note: shortened.note };
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

/** The result content Claude Code made, with the full output back in it:
 *  anything it added around the output (a note that the working directory
 *  was reset) stays. When the short version can't be found in it, stdout
 *  then stderr, just the full output. */
function fullContent(content: string, s: Shortened): string {
  const shownOut = s.modelStdout.trimEnd();
  const shownErr = s.modelStderr.trimEnd();
  const i = content.indexOf(shownOut);
  const j = shownErr ? content.indexOf(shownErr, i + shownOut.length) : -1;
  if (i < 0 || (shownErr && j < 0)) return joinOutput(s.stdout, s.stderr);
  // All of stderr went: it goes back after stdout, where Claude Code puts it.
  if (!shownErr) return content.slice(0, i) + joinOutput(s.stdout, s.stderr) + content.slice(i + shownOut.length);
  return content.slice(0, i) + s.stdout.trimEnd() + content.slice(i + shownOut.length, j)
    + s.stderr.trimEnd() + content.slice(j + shownErr.length);
}

/** Save `text` as `toolUseId`'s full output. Its path, or null if it
 *  couldn't be saved. */
async function saveFullOutput(folder: string, toolUseId: string, text: string): Promise<string | null> {
  const file = path.join(folder, `${toolUseId.replace(/[^A-Za-z0-9_-]/g, '_') || 'output'}.txt`);
  try {
    await fs.promises.mkdir(folder, { recursive: true });
    await fs.promises.writeFile(file, text, 'utf-8');
    return file;
  } catch (err) {
    logger.warn(`[shorten-output] could not save the full output of ${toolUseId}:`, err);
    return null;
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

    const short = shortenCommandOutput(command, stdout, stderr);
    if (!short) return {};
    const file = await saveFullOutput(folder, input.tool_use_id, joinOutput(stdout, stderr));
    if (!file) return {};
    const modelStdout = `${short.stdout}${short.stdout ? '\n' : ''}${shortenedFooter(file)}`;
    const fullChars = stdout.length + stderr.length;
    const modelChars = modelStdout.length + short.stderr.length;
    if (modelChars >= fullChars) return {};

    shortened.add(input.tool_use_id, {
      stdout,
      stderr,
      modelStdout,
      modelStderr: short.stderr,
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
