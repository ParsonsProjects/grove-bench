# Grove Bench

Multi-agent git worktree orchestrator for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Mistral Agents API](https://docs.mistral.ai/agents). A Windows-native Electron desktop app that manages concurrent AI coding sessions, each in an isolated git worktree with a dedicated PTY terminal.

## Features

- Multi-provider support - Run Claude Code or Mistral agents in parallel
- Concurrent agent sessions - Multiple sessions per provider, each in its own git worktree
- Isolated worktrees - Every session gets a dedicated worktree so agents never conflict
- Integrated terminal - Built-in xterm.js terminals with full PTY support
- Session management - Start, monitor, and stop agent sessions from a single UI
- Project memory - Persistent memory system across sessions
- Provider switching - Easily switch between Claude and Mistral

## Tech Stack

Electron, Svelte 5, Tailwind CSS v4, TypeScript, node-pty, xterm.js, @anthropic-ai/claude-agent-sdk, @mistralai/mistralai

## Getting Started

### Prerequisites

For Claude Code: Install the CLI with npm install -g @anthropic-ai/claude-code and run claude auth login.

For Mistral: Set the MISTRAL_API_KEY environment variable with your API key from https://console.mistral.ai/.

### Installation

Install dependencies (including both SDKs):

npm install

Run in development mode:

npm start

## Usage

When creating a new session, select your preferred AI provider from the adapter dropdown. Each provider has its own set of models and capabilities.

## Scripts

Command | Description
---|---
npm start | Run in dev mode
npm run dist | Build distributable installer
npm test | Run all tests
npm run test:watch | Watch mode
npm run test:coverage | Run tests with coverage

## License

MIT