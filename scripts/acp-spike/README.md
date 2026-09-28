# ACP spike (Phase 0)

Throwaway checks for `docs/open-model-harnesses-plan.md`. Not part of the app:
nothing here is built, bundled or tested by `npm test`. It has its own
`package.json`, which pins OpenCode 1.18.33 and the ACP SDK 1.5.1.

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
plan mode, provider errors, load/resume/fork, the local server password and
Grove's memory tools over HTTP MCP. Every PASS means OpenCode still behaves
as the plan's "Spike findings" section says. Re-run it before bumping the
pinned OpenCode version.

## Real check (Windows, your OpenRouter key)

PowerShell:

```
$env:OPENROUTER_API_KEY = "sk-or-..."
node probe-real.mjs                 # the opencode.exe that npm install fetched
node probe-real.mjs --from-path     # or the opencode on your PATH
```

Runs one small coding task on `deepseek/deepseek-v4.1-flash` in a new temp
folder, then tries a wrong key. It covers what the offline check can't: the
real model's tool use, the Windows shell, Windows paths, the npm shim, time
and cost. Expected cost is well under $0.01.

It uses a separate temp home for OpenCode, so your own OpenCode config,
sign-ins and sessions are not read or changed. Edits outside the temp folder
are rejected, and only `node` and file-listing commands may run.

Please send back the console output and `fixtures/real-win32.jsonl` (the
recorded session; your key never appears in it).

`node probe-real.mjs --fake` runs the same script against the local fake, to
test the script itself.

## Files

- `lib.mjs`: find the binary, isolated home, spawn and record, report.
- `fake-openrouter.mjs`: scripted fake of the chat completions endpoint.
- `fixtures/`: recordings from the offline run, trimmed (model list cut,
  temp paths replaced by `<TMP>`). Input for the Phase 3 event mapper tests.
