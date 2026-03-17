#!/usr/bin/env node

/**
 * Docker container entrypoint for orchestrator subtask agents.
 *
 * Protocol (stdin/stdout JSONL):
 *   Host → Container: {"type":"init","prompt":"...","systemPrompt":{...},"permissionMode":"acceptEdits","sandbox":{...}}
 *                      {"type":"abort"}
 *   Container → Host:  {"type":"ready"}
 *                      {"type":"sdk_message","message":{...}}
 *                      {"type":"exit","code":0,"error":null}
 */

import { createInterface } from 'node:readline';

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function log(msg) {
  process.stderr.write(`[worker] ${msg}\n`);
}

// Validate SDK import early so we get a clear error
let query;
try {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  query = sdk.query;
  log('SDK loaded successfully');
} catch (err) {
  log(`SDK import failed: ${err.message}`);
  send({ type: 'exit', code: 1, error: `SDK import failed: ${err.message}` });
  process.exit(1);
}

const abortController = new AbortController();

// Handle SIGTERM gracefully
process.on('SIGTERM', () => {
  log('Received SIGTERM, aborting...');
  abortController.abort();
});

// Catch unhandled rejections
process.on('unhandledRejection', (reason) => {
  log(`Unhandled rejection: ${reason}`);
  send({ type: 'exit', code: 1, error: `Unhandled rejection: ${reason}` });
  process.exit(1);
});

// Fix worktree .git reference — the host creates worktrees with absolute Windows paths
// that don't exist inside the container. We rewrite them to use /repo-git.
const worktreeId = process.env.GROVE_WORKTREE_ID;
if (worktreeId) {
  const fs = await import('node:fs');
  const gitFile = '/workspace/.git';
  try {
    const content = fs.readFileSync(gitFile, 'utf-8');
    if (content.startsWith('gitdir:')) {
      // Rewrite to point to the mounted repo .git directory
      const newGitdir = `/repo-git/worktrees/${worktreeId}`;
      fs.writeFileSync(gitFile, `gitdir: ${newGitdir}\n`);
      log(`Fixed .git: gitdir → ${newGitdir}`);

      // Also fix the reverse pointer so git can find the worktree
      const reverseFile = `${newGitdir}/gitdir`;
      if (fs.existsSync(reverseFile)) {
        fs.writeFileSync(reverseFile, '/workspace\n');
        log(`Fixed reverse gitdir → /workspace`);
      }
    }
  } catch (err) {
    log(`Warning: could not fix .git file: ${err.message}`);
  }
}

// Signal readiness
send({ type: 'ready' });
log('Ready, waiting for init message...');

// Read init message from stdin
const rl = createInterface({ input: process.stdin });

let initialized = false;

for await (const line of rl) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    log(`Failed to parse stdin line: ${line.slice(0, 100)}`);
    continue;
  }

  log(`Received message type: ${msg.type}`);

  if (msg.type === 'abort') {
    abortController.abort();
    break;
  }

  if (msg.type === 'init' && !initialized) {
    initialized = true;

    const { prompt, systemPrompt, permissionMode, sandbox } = msg;
    log(`Init received, prompt length: ${prompt?.length ?? 0}`);

    // Log auth environment
    log(`ANTHROPIC_API_KEY set: ${!!process.env.ANTHROPIC_API_KEY}`);
    log(`CLAUDE_CODE_OAUTH_TOKEN set: ${!!process.env.CLAUDE_CODE_OAUTH_TOKEN}`);

    let exitCode = 0;
    try {
      // Create a single-shot prompt stream
      const promptStream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: 'user',
            session_id: '',
            message: { role: 'user', content: prompt },
            parent_tool_use_id: null,
          });
          controller.close();
        },
      });

      // Convert ReadableStream to AsyncIterable
      const asyncIterable = {
        [Symbol.asyncIterator]() {
          const reader = promptStream.getReader();
          return {
            async next() {
              const { done, value } = await reader.read();
              if (done) return { done: true, value: undefined };
              return { done: false, value };
            },
            async return() {
              reader.releaseLock();
              return { done: true, value: undefined };
            },
          };
        },
      };

      log('Calling SDK query()...');

      // Wrap query() call in a timeout to detect hangs
      const queryStarted = Date.now();
      // Log periodic progress while waiting for first message
      let progressInterval = setInterval(() => {
        const elapsed = Math.round((Date.now() - queryStarted) / 1000);
        log(`Still waiting for first SDK message... ${elapsed}s elapsed`);
      }, 10_000);
      const queryTimeout = setTimeout(() => {
        const elapsed = Math.round((Date.now() - queryStarted) / 1000);
        log(`WARNING: SDK query() has not yielded any messages after ${elapsed}s — may be stuck on auth or API connection`);
      }, 15_000);

      // Docker IS the sandbox — disable OS-level sandboxing (seatbelt/bubblewrap)
      // inside the container. The host's sandbox config has host-specific paths
      // that don't exist here and would cause the SDK to hang.
      const q = query({
        prompt: asyncIterable,
        options: {
          cwd: '/workspace',
          pathToClaudeCodeExecutable: '/usr/local/bin/claude',
          abortController,
          settingSources: ['project'],
          systemPrompt: systemPrompt || { type: 'preset', preset: 'claude_code' },
          permissionMode: permissionMode || 'acceptEdits',
          sandbox: { enabled: false },
          canUseTool: async (_toolName, input) => {
            return { behavior: 'allow', updatedInput: input };
          },
          env: {
            ...process.env,
            CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
          },
        },
      });

      log('SDK query() returned, starting iteration...');

      // Stream SDK messages to stdout
      let msgCount = 0;
      for await (const message of q) {
        if (msgCount === 0) {
          clearTimeout(queryTimeout);
          clearInterval(progressInterval);
          log(`First SDK message received after ${Date.now() - queryStarted}ms, type=${message?.type}`);
        }
        if (abortController.signal.aborted) break;
        msgCount++;
        send({ type: 'sdk_message', message });
      }

      clearTimeout(queryTimeout);
      log(`SDK query complete, ${msgCount} messages sent`);
      send({ type: 'exit', code: 0, error: null });
    } catch (err) {
      exitCode = 1;
      const errMsg = err.message || String(err);
      log(`SDK query failed: ${errMsg}`);
      if (err.stack) log(err.stack);
      send({ type: 'exit', code: 1, error: errMsg });
    }

    process.exit(exitCode);
  }
}
