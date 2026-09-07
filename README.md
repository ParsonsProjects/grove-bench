# Grove Bench

Multi-agent git worktree orchestrator for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Mistral Agents API](https://docs.mistral.ai/agents). A Windows-native Electron desktop app that manages concurrent AI coding sessions, each in an isolated git worktree with a dedicated PTY terminal.

## Features

- **Multi-provider support** - Run Claude Code or Mistral agents in parallel
- **Concurrent agent sessions** - Multiple sessions per provider, each in its own git worktree
- **Isolated worktrees** - Every session gets a dedicated worktree so agents never conflict
- **Integrated terminal** - Built-in xterm.js terminals with full PTY support
- **Session management** - Start, monitor, and stop agent sessions from a single UI
- **Project memory** - Persistent memory system across sessions
- **Provider switching** - Easily switch between Claude and Mistral
- **Permission controls** - Fine-grained tool permission management per session
- **Model selection** - Choose from available models for each provider
- **Retry logic** - Automatic retry with exponential backoff for transient failures

## Tech Stack

Electron, Svelte 5, Tailwind CSS v4, TypeScript, node-pty, xterm.js, @anthropic-ai/claude-agent-sdk, @mistralai/mistralai

## Getting Started

### Prerequisites

#### For Claude Code:
Install the CLI globally and authenticate:
```bash
npm install -g @anthropic-ai/claude-code
claude auth login
```

#### For Mistral:
Set the `MISTRAL_API_KEY` environment variable with your API key from [Mistral Console](https://console.mistral.ai/).

You can set it in your shell:
```bash
export MISTRAL_API_KEY=your-api-key-here
```

Or configure it in Grove Bench's Settings panel.

### Installation

1. Clone the repository:
```bash
git clone https://github.com/ParsonsProjects/grove-bench.git
cd grove-bench
```

2. Install dependencies (including both SDKs):
```bash
npm install --legacy-peer-deps
```

3. Run in development mode:
```bash
npm start
```

## Usage

### Creating a New Session

1. Click the "New Agent" button or use the shortcut
2. Select a repository from the dropdown
3. Choose your preferred AI provider from the **Adapter** dropdown:
   - **Claude Code** - Uses the Claude Code CLI
   - **Mistral** - Uses the Mistral Agents API
4. Select a branch mode:
   - **New branch** - Creates a fresh worktree branch
   - **Existing branch** - Uses an existing worktree
   - **Direct** - Runs directly on the current branch (no worktree)
5. Click "Create"

### Switching Providers

- Each session can use a different provider
- Switch providers when creating a new session via the Adapter dropdown
- The provider is displayed in the session tab

### Mistral-Specific Configuration

In the Settings panel (under the **Agent** tab):

- **Mistral Default Model**: Select the default model for new Mistral sessions
  - Codestral (default, optimized for coding)
  - Mistral Large
  - Mistral Medium
  - Mistral Small
  - Mistral Tiny

- **Mistral API Key**: Enter your API key from [Mistral Console](https://console.mistral.ai/)
  - Click "Test Connection" to verify your API key works
  - The key is stored locally and encrypted at rest

### Permission Management

Grove Bench provides fine-grained control over tool permissions:

- **Default Permission Mode**: Set the default mode for new sessions
  - `default` - Ask for each tool use
  - `plan` - Read-only mode, agent can only read files
  - `acceptEdits` - Auto-accept file edits
  - `bypassPermissions` - No permission prompts (use with caution)

- **Tool Allow Rules**: Patterns for tools that are always allowed
- **Tool Deny Rules**: Patterns for tools that are always denied
- **Disable Bypass Mode**: Prevent users from enabling bypass mode

### Session Management

- **Auto-stop idle sessions**: Automatically stop sessions after a configurable idle period
- **Always on Top**: Keep Grove Bench window always on top of other windows
- **Repository Colors**: Assign custom accent colors to repositories for easy identification

## Scripts

| Command | Description |
|---|---|
| `npm start` | Run in dev mode |
| `npm run dist` | Build distributable installer |
| `npm test` | Run all tests |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Run tests with coverage |
| `npm run test:main` | Run main process tests only |
| `npm run test:renderer` | Run renderer process tests only |

## Configuration

### Environment Variables

| Variable | Description | Required |
|---|---|---|
| `MISTRAL_API_KEY` | Mistral API key | Yes (for Mistral) |
| `MISTRAL_DEFAULT_MODEL` | Default Mistral model | No (defaults to `codestral-latest`) |

### Settings File

Settings are stored in `%APPDATA%\grove-bench\settings.json` (Windows) or `~/.config/grove-bench/settings.json` (macOS/Linux).

The settings file includes:
- API keys (encrypted at rest)
- Default models
- Permission rules
- UI preferences
- Repository configurations

## Architecture

### Adapter System

Grove Bench uses an adapter pattern to support multiple AI providers:

```
┌─────────────────────────────────────────────────┐
│                   Grove Bench                       │
├─────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐              │
│  │  Adapter     │    │  Adapter     │              │
│  │  Registry    │    │  Registry    │              │
│  └──────┬──────┘    └──────┬──────┘              │
│         │                  │                      │
│  ┌──────▼──────┐   ┌──────▼──────┐              │
│  │ClaudeCode   │   │  Mistral    │              │
│  │Adapter      │   │  Adapter    │              │
│  └─────────────┘   └─────────────┘              │
└─────────────────────────────────────────────────┘
```

Each adapter implements the `AgentAdapter` interface with methods for:
- Starting sessions
- Sending messages
- Managing permissions
- Listing models
- Checking prerequisites

### Session Lifecycle

1. **Create**: User creates a new session, worktree is created
2. **Start**: Adapter starts the agent process/connection
3. **Running**: Agent processes messages, executes tools
4. **Stop**: User stops the session, worktree is preserved
5. **Destroy**: Session and worktree are deleted

## Troubleshooting

### Mistral API Issues

**"Invalid API key" error:**
- Verify your API key is correct
- Check that the key hasn't expired
- Ensure you have sufficient credits

**"Rate limit exceeded" error:**
- Wait a moment and retry
- Grove Bench will automatically retry with exponential backoff
- Consider upgrading your Mistral plan

**"Model not found" error:**
- Ensure you're using a valid model ID
- Check Mistral's [model documentation](https://docs.mistral.ai/models/)
- Update Grove Bench to the latest version

### Claude Code Issues

**"Claude Code CLI not found" error:**
- Install the CLI: `npm install -g @anthropic-ai/claude-code`
- Run `claude auth login` to authenticate
- Restart Grove Bench

**"Not authenticated" error:**
- Run `claude auth login` in your terminal
- Ensure you're logged in with the correct account

### General Issues

**"No repositories found"**:
- Add a repository by clicking "Add Repository" in the sidebar
- Ensure the repository path is valid and accessible

**"Worktree already exists"**:
- Use "Existing branch" mode to reuse an existing worktree
- Or delete the existing worktree first

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Submit a pull request

## License

MIT
