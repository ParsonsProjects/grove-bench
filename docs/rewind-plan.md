# /rewind — Implementation Plan

## Overview

`/rewind` lets the user roll back to a previous message checkpoint. Files on disk are restored to their state at that point, and UI messages after that point are removed. The user can then continue the conversation from there.

## SDK Support

The Agent SDK exposes `rewindFiles()` on the Query object:

```typescript
query.rewindFiles(userMessageId: string, options?: { dryRun?: boolean }): Promise<RewindFilesResult>
```

- Restores **files on disk** to their state at a specific user message
- Does **NOT** rewind the conversation history — the LLM context stays intact
- Requires `enableFileCheckpointing: true` in query options
- Requires `extraArgs: { 'replay-user-messages': null }` to capture checkpoint UUIDs
- Only tracks changes made through Write, Edit, and NotebookEdit tools (NOT Bash commands)

## Limitations

- File-level only — Bash `sed`, `mv`, `rm` etc. are not tracked
- Conversation context is not rewound — Claude still remembers everything after the rewind point
- Direct-mode sessions (no worktree) rewind files in the actual repo

## Changes Required

### 1. `src/main/agent-session.ts` — Enable checkpointing + expose rewind

- Add `enableFileCheckpointing: true` to the `query()` options
- Add `extraArgs: { 'replay-user-messages': null }` so the SDK tracks user message UUIDs
- Add method `rewindFiles(sessionId: string, userMessageId: string): Promise<void>` that calls `query.rewindFiles(userMessageId)` on the Query instance
- Emit a `{ type: 'rewind', toMessageId }` event after successful rewind

### 2. `src/shared/types.ts` — IPC additions

- Add `rewindSession(sessionId: string, userMessageId: string): Promise<void>` to `GroveBenchAPI`
- Add `IPC.AGENT_REWIND` channel constant
- Add `AgentEvent` variant: `{ type: 'rewind'; toMessageId: string }`

### 3. `src/main/ipc.ts` — Wire up the handler

- Add `AGENT_REWIND` handler that calls `sessionManager.rewindFiles(id, userMessageId)`

### 4. `src/main/preload.ts` — Expose to renderer

- Add `rewindSession` to the contextBridge API

### 5. `src/renderer/stores/messages.svelte.ts` — Handle /rewind

- In `sendCommand()`, intercept `/rewind` — don't send to SDK, instead trigger the rewind picker UI
- Add `getRewindPoints(sessionId)` — returns list of user messages with IDs and text (extracted from `messagesBySession`)
- Add `executeRewind(sessionId, messageId)` — calls IPC `rewindSession`, then truncates `messagesBySession` to remove everything after the chosen message
- Handle the `rewind` AgentEvent to sync state if triggered from elsewhere

### 6. `src/renderer/components/RewindDialog.svelte` — New component

- Modal listing user messages as selectable checkpoints
- Each entry shows: message number, message text (truncated), position in conversation
- Click one → confirm → calls `executeRewind`
- Most recent messages at the top

### 7. `src/renderer/components/PromptEditor.svelte` — Add to slash commands

- Add `{ name: '/rewind', description: 'Rewind to a previous message' }` to the commands array

## Flow

```
User types /rewind
  → PromptEditor intercepts, opens RewindDialog
  → User picks a message
  → renderer calls window.groveBench.rewindSession(sessionId, messageId)
  → main calls query.rewindFiles(messageId) — restores files on disk
  → main emits { type: 'rewind', toMessageId } event
  → renderer truncates message list after that point
  → user continues conversation from that checkpoint
```
