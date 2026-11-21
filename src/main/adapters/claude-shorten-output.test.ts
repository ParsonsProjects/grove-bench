import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { ShortenedOutputs, shortenOutputHook, shortenedFooter } from './claude-shorten-output.js';
import { COMMAND_OUTPUT_FOLDER } from '../../shared/attachments.js';
import { shortenCommandOutput } from '../output-filter.js';

type Hook = ReturnType<typeof shortenOutputHook>;
type HookResult = { hookSpecificOutput?: { hookEventName: string; updatedToolOutput?: Record<string, unknown> } };

/** 60 passing pytest lines and its summary: shortened to two lines. */
const PYTEST = `${Array.from({ length: 60 }, (_, i) => `test_a.py::test_${i} PASSED${' '.repeat(40)}[ ${i}%]`).join('\n')}\n=== 60 passed in 0.10s ===`;

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-shorten-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function bash(command: string, response: Record<string, unknown>, toolUseId = 'toolu_01') {
  return {
    hook_event_name: 'PostToolUse', session_id: 's', transcript_path: '', cwd: '/w',
    tool_name: 'Bash', tool_input: { command }, tool_use_id: toolUseId,
    tool_response: { stdout: '', stderr: '', interrupted: false, ...response },
  };
}

async function run(hook: Hook, input: unknown): Promise<HookResult> {
  return await hook(input as Parameters<Hook>[0], 'toolu_01', { signal: new AbortController().signal }) as HookResult;
}

describe('shortenOutputHook', () => {
  it("hands the model the short version in the Bash tool's own shape, with where the full one is", async () => {
    const shortened = new ShortenedOutputs();
    const result = await run(shortenOutputHook(shortened, dir), bash('pytest -v', { stdout: PYTEST, returnCodeInterpretation: 'x' }));
    const file = path.join(dir, COMMAND_OUTPUT_FOLDER, 'toolu_01.txt');
    expect(result.hookSpecificOutput).toEqual({
      hookEventName: 'PostToolUse',
      updatedToolOutput: {
        stdout: `[hidden: 60 lines about passing tests]\n=== 60 passed in 0.10s ===\n${shortenedFooter(file)}`,
        stderr: '',
        interrupted: false,
        returnCodeInterpretation: 'x',
      },
    });
    expect(fs.readFileSync(file, 'utf-8')).toBe(PYTEST);
  });

  it('keeps the full output for the result, once, and counts what it saved', async () => {
    const shortened = new ShortenedOutputs();
    const result = await run(shortenOutputHook(shortened, dir), bash('pytest -v', { stdout: PYTEST }));
    const modelStdout = result.hookSpecificOutput!.updatedToolOutput!.stdout as string;
    // Claude Code shows the model stdout, then a note of its own.
    const taken = shortened.takeResult('toolu_01', `${modelStdout}\nShell cwd was reset to /w`)!;
    expect(taken.content).toBe(`${PYTEST}\nShell cwd was reset to /w`);
    expect(taken.note).toMatchObject({ families: ['test'], fullChars: PYTEST.length, modelChars: modelStdout.length });
    expect(taken.note.savedTokens).toBe(Math.round((PYTEST.length - modelStdout.length) / 4));
    expect(shortened.takeResult('toolu_01', modelStdout)).toBeNull();
    expect(shortened.takeSavedTokens()).toBe(taken.note.savedTokens);
    expect(shortened.takeSavedTokens()).toBe(0);
  });

  it('puts stderr back after stdout when none of it was left', async () => {
    const shortened = new ShortenedOutputs();
    const progress = Array.from({ length: 40 }, (_, i) => `remote: Counting objects: ${i}% (${i}/40)`).join('\n');
    const result = await run(shortenOutputHook(shortened, dir), bash('git push', { stdout: 'Everything pushed', stderr: progress }));
    const modelStdout = result.hookSpecificOutput!.updatedToolOutput!.stdout as string;
    expect(result.hookSpecificOutput!.updatedToolOutput!.stderr).toBe('');
    expect(shortened.takeResult('toolu_01', `${modelStdout}\nShell cwd was reset to /w`)!.content)
      .toBe(`Everything pushed\n${progress}\nShell cwd was reset to /w`);
  });

  it('finds the short stderr in the result when Claude Code trimmed it', async () => {
    const shortened = new ShortenedOutputs();
    const stderr = `   WARN  something to keep\n${Array.from({ length: 40 }, (_, i) => `remote: Counting objects: ${i}% (${i}/40)`).join('\n')}`;
    const result = await run(shortenOutputHook(shortened, dir), bash('git push', { stdout: 'Everything pushed', stderr }));
    const { stdout: modelStdout, stderr: modelStderr } = result.hookSpecificOutput!.updatedToolOutput! as { stdout: string; stderr: string };
    expect(modelStderr).toBe('   WARN  something to keep');
    const content = `${modelStdout}\n${modelStderr.trim()}\nShell cwd was reset to /w`;
    expect(shortened.takeResult('toolu_01', content)!.content).toBe(`Everything pushed\n${stderr.trim()}\nShell cwd was reset to /w`);
  });

  it("counts nothing and shows no note when the model didn't get Grove's version (another hook's won)", async () => {
    const shortened = new ShortenedOutputs();
    await run(shortenOutputHook(shortened, dir), bash('pytest -v', { stdout: PYTEST }));
    expect(shortened.takeResult('toolu_01', 'what another hook made of it')).toBeNull();
    expect(shortened.takeSavedTokens()).toBe(0);
  });

  it('counts the footer against the savings, and saves nothing when that leaves too little', async () => {
    // The rules save about 450 characters of 1,250: enough on their own,
    // not once the footer is added.
    const stdout = `${Array.from({ length: 12 }, (_, i) => `test tests::t${i} ... ok${' '.repeat(18)}`).join('\n')}\n${'x'.repeat(800)}`;
    expect(shortenCommandOutput('cargo test', stdout, '')).not.toBeNull();
    const shortened = new ShortenedOutputs();
    expect(await run(shortenOutputHook(shortened, dir), bash('cargo test', { stdout }))).toEqual({});
    expect(fs.existsSync(path.join(dir, COMMAND_OUTPUT_FOLDER))).toBe(false);
  });

  it('keeps the last 100 outputs waiting for their results', async () => {
    const shortened = new ShortenedOutputs();
    const hook = shortenOutputHook(shortened, dir);
    const results: string[] = [];
    for (let i = 0; i < 101; i++) {
      const r = await run(hook, bash('pytest -v', { stdout: PYTEST }, `tu${i}`));
      results.push(r.hookSpecificOutput!.updatedToolOutput!.stdout as string);
    }
    expect(shortened.takeResult('tu0', results[0])).toBeNull();
    expect(shortened.takeResult('tu1', results[1])).not.toBeNull();
    expect(shortened.takeResult('tu100', results[100])).not.toBeNull();
  });

  it.each([
    ['another tool', { ...bash('pytest -v', { stdout: PYTEST }), tool_name: 'Read' }],
    ['another event', { ...bash('pytest -v', { stdout: PYTEST }), hook_event_name: 'PreToolUse' }],
    ['a command stopped partway', bash('pytest -v', { stdout: PYTEST, interrupted: true })],
    ['a command in the background', bash('pytest -v', { stdout: PYTEST, backgroundTaskId: 'b1' })],
    ['output Claude Code saved as too large', bash('pytest -v', { stdout: PYTEST, persistedOutputPath: '/t/out.txt' })],
    ['an image', bash('pytest -v', { stdout: PYTEST, isImage: true })],
    ['a command it has no rules for', bash('cat log.txt', { stdout: PYTEST })],
    ['no stdout', bash('pytest -v', { stdout: undefined })],
  ])('leaves %s alone', async (_what, input) => {
    const shortened = new ShortenedOutputs();
    expect(await run(shortenOutputHook(shortened, dir), input)).toEqual({});
    expect(shortened.takeSavedTokens()).toBe(0);
  });

  it("leaves the output alone when the full one can't be saved", async () => {
    const notAFolder = path.join(dir, 'file');
    fs.writeFileSync(notAFolder, '');
    const shortened = new ShortenedOutputs();
    expect(await run(shortenOutputHook(shortened, notAFolder), bash('pytest -v', { stdout: PYTEST }))).toEqual({});
    expect(shortened.takeResult('toolu_01', PYTEST)).toBeNull();
  });

  it('names the saved file from the tool call, without path characters', async () => {
    const shortened = new ShortenedOutputs();
    await run(shortenOutputHook(shortened, dir), bash('pytest -v', { stdout: PYTEST }, '../x/y'));
    expect(fs.readdirSync(path.join(dir, COMMAND_OUTPUT_FOLDER))).toEqual(['___x_y.txt']);
  });
});
