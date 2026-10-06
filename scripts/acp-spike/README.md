# OpenCode ACP checks

Checks behind the OpenCode preset (`src/main/adapters/acp/opencode.ts`,
`docs/open-model-harnesses-plan.md`). Not part of the app: nothing here is
built, bundled or tested by `npm test`. It has its own
`package.json`, which pins OpenCode 1.18.32 and the ACP SDK 1.5.0, and its
own `.npmrc` with the app's rules: npm 11.10 or later, and only versions
published at least 7 days ago (the Dependency age workflow checks the
lockfile too).

```
cd scripts/acp-spike
npm install
```

## Offline check (any OS, no key, no network)

```
node probe-offline.mjs                  # add --save-fixtures to refresh fixtures/
```

Runs `opencode acp` against a local fake of OpenRouter's chat completions API
and checks the behaviour the plan relies on: handshake and capabilities,
live model switching, permission prompts and diffs, always-allow, cancel,
plan mode, provider errors (wrong key, out of credit, rate limits, errors
mid-stream), load/resume/fork, the local server password and Grove's memory
tools over HTTP MCP. Takes about a minute. Every PASS means OpenCode still behaves
as the plan's "Spike findings" section says. Re-run it before bumping the
pinned OpenCode version.

## Rewind check (any OS, no key, no network)

```
node probe-revert.mjs               # in a git repository, as a Grove worktree is
node probe-revert.mjs --no-git      # in a plain folder
node probe-revert.mjs --restart     # a new process resumes the session after the revert
```

ACP can't make an agent forget turns, but `opencode acp` also runs OpenCode's
HTTP server. This checks whether `POST /session/:id/revert` there, with the
ACP connection open, makes the model forget the reverted turns, which message
a revert removes, what it does to files, and how to find OpenCode's id for a
message. Findings are in `docs/open-model-harnesses-plan.md`.

## Real check (Windows, your OpenRouter key)

PowerShell:

```
$env:OPENROUTER_API_KEY = "sk-or-..."
node probe-real.mjs                 # the opencode.exe that npm install fetched
node probe-real.mjs --from-path     # or the opencode on your PATH
```

Runs one small coding task on `deepseek/deepseek-v4.1-flash` in a new temp
folder, presses Stop part-way through a second task and checks the session
still works, then tries a wrong key. It covers what the offline check can't:
the real model's tool use, the Windows shell, Windows paths, the npm shim,
Stop against the real provider, time and cost. Expected cost is well under
$0.01.

Every OpenCode process it starts gets a separate temp home, so your own
OpenCode config, sign-ins and sessions are not read or changed. The script
proves this: it records your real OpenCode folders (under your user profile
and AppData) before it starts and fails if anything in them changed. Close
any OpenCode you have running first, or that check will see its changes.
Edits outside the temp folder are rejected, and only `node` and
file-listing commands may run.

Please send back the console output and `fixtures/real-win32.jsonl` (the
recorded session; your key never appears in it).

`node probe-real.mjs --fake` runs the same script against the local fake, to
test the script itself.

## Files

- `lib.mjs`: find the binary, isolated home, spawn and record, report.
- `fake-openrouter.mjs`: scripted fake of the chat completions endpoint.
- `fixtures/`: recordings from the offline run, trimmed (model list cut,
  temp paths replaced by `<TMP>`): what OpenCode actually sends over ACP.
