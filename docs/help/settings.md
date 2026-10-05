# Settings

Open Settings from the gear icon in the sidebar bottom controls, or press `Ctrl+,`. Each section has a grove name, with its plain name under it (for example **Tool shed** for MCP servers). Pick a section on the left, or type in **Search settings** to find a setting by name, or by either section name: press `Enter` or click a result to go straight to it. `Escape` clears the search, and a second `Escape` closes Settings.

Changes save as you make them; there is no Save button. Toggles and lists save at once, text fields once you pause typing, and number fields when you leave the field or press `Enter`. A number that isn't valid shows a message under the field and isn't saved. The bottom of the panel says when all changes are saved. If a save fails it shows the error, keeps your change and offers **Try again**.

## The grove (General)

- **Default thread view**: The view new threads start in (Summary, Focus or Detailed). Each thread can switch from its status bar
- **Default diff view**: How the Changes and Checkpoints tabs first show a file's changes, with a small example of each: **Unified** (removed and added lines in one column) or **Side-by-side** (the old and new file next to each other). Each file can switch there with its unified / side-by-side button, or `V`
- **Show grove characters**: Small pixel agents show each thread's status: in the sidebar in place of the status dot, in permission and question prompts, when no thread is open, on the Changes, Checkpoints and Preview tabs while they have nothing to show (each with its own touch: a watering can, a flag, an easel), and while a thread starts up again, where its agent walks through the grove. A pixel grove also grows along the top of the status bar as the thread fills its context window, and its leaves turn from summer green to autumn as it nears the limit. When you open a sleeping or closed thread, its agent first wakes up on a bench, then walks off; click or press any key to skip straight to the chat. When you start a new thread, its agent walks up to that bench below your first message, sits down and starts typing, and stays there until the first reply shows. The pose shows the state as well as the colour: typing while working, a question mark while it waits for you, waving after it finishes a turn, asleep when closed or sleeping (grey). Each thread's agent has its own skin tone and hair colour, and keeps them wherever it appears. On by default
- **Project colors**: The accent color for each project in the sidebar. **Use default** puts a project back on its default color
- **Always on top**: Keep the Grove Bench window above other windows
- **Spell checking**: Check spelling in the prompt editor
- **Updates**: Shows the version you're running, with a link to all releases. **Check for updates** checks now and says what it found. With **Download updates automatically** on (the default), a new version downloads in the background and installs the next time you quit. When it's ready, **Restart to update** appears in the title bar to install it straight away: it stops every thread the way quitting does (asking first if any are still working), installs, and reopens Grove Bench, where your threads reopen. **What's new** next to it opens that version's release notes. With the option off, the title bar shows **Update available** and waits for you to click it to download. Updates are only checked in the installed app

## Grovekeepers (Agents)

Each group in this section folds: click its heading to fold it away or open it again. The default agent's group and **All agents** start open, the rest start folded, and each stays as you left it until Grove Bench restarts. Searching for a setting opens the group it is in.

There is one group per agent, each with:

- **Credentials**: Shows how the agent signs in. Paste an API key to save it (stored encrypted on this computer), or remove a saved key. While a key is saved it is used instead of a CLI sign-in. For agents that sign in with their own program (Gemini CLI, GitHub Copilot CLI) it shows whether the last try got in, the sign-in command with a copy button, and **Check sign-in**, which starts the agent for a moment to find out. When the agent isn't installed, the command that installs it is shown too
- **Default model**: Pick the model new threads with this agent start on. The list comes from the agent itself and updates after a thread starts, so new models appear without an app update. **Default** follows the agent's own default model (shown in brackets). A model ID typed in an older version stays in the list, marked "custom"
- **Background model**: The model used for this agent's background tasks: memory notes, memory compaction, commit messages, skill suggestions and thread goals. **Default** is the agent's own cheap model (Haiku 4.5 for Claude Agent). Each task runs on the agent of the thread it belongs to, so a thread's content only goes to the provider you chose for it
- **Default permission mode**: The mode new threads with this agent start in. Only the modes the agent offers on its default model are listed. See [Status bar](status-bar.md#mode) for what each mode allows. For Claude Agent:
  - **Ask**: checks with you before each edit or command; reading files and read-only commands run without asking
  - **Plan**: explores and plans without editing files
  - **Edit**: accepts file edits inside the worktree
  - **Auto**: Claude's classifier approves or blocks each action instead of asking
  - **Read-safe**: Grove Bench's own mode, under the "Grove Bench" divider. Accepts edits and read-only commands; everything else asks
  - For agents that speak ACP (Gemini CLI, GitHub Copilot CLI and any you add), Grove Bench applies the modes itself, on the requests the agent sends before it runs a tool. **Ask** puts every request to you, **Edit** approves file edits inside the worktree, and **Read-safe** also approves read-only commands inside the worktree. The agent's own modes and options (for example Gemini CLI's YOLO or Plan) show as separate controls once a thread has started
- **Default effort**, **Default thinking**, **Default speed**: The thread controls the agent declares for its default model (for Claude Agent, each one shows only when the default model offers it). Pick the value new threads start with; each thread can still change it from the status bar

If a thread starts on a model that doesn't offer the saved mode, it starts in Code instead.

**All agents** holds the settings that apply to every agent:

- **System prompt append**: Instructions added to every thread
- **Additional working directories**: Folders outside the project that agents can also use
- **Response style**: Normal, or one of three "caveman" styles that cut the agent's wording to use about 65 to 75% fewer output tokens. Code blocks stay normal. **Caveman lite** drops filler and hedging, **Caveman full** also drops articles, and **Caveman ultra** compresses the most, with abbreviations
- **Show thinking summaries** (shown when an agent offers it, such as Claude Agent): Show a short summary of the model's thinking in the thread. Newer Claude models send no thinking text unless asked, so with this off their thinking doesn't show. Some older models, such as Haiku 4.5, may still show theirs. It doesn't change how much the model thinks or what it costs. Applies to agents started after the change (on by default)
- **Let the agent use the Preview browser**: Give the agent its own page in the [Preview tab](preview-tab.md#the-agents-browser) to open local pages, take screenshots, read, click and type in. Applies to agents started after the change (on by default)

### Other agents (ACP)

Grove Bench can run any agent that speaks the [Agent Client Protocol](https://agentclientprotocol.com) (ACP) over stdio. Gemini CLI (`gemini --acp`) and GitHub Copilot CLI (`copilot --acp`) are built in: install one (`npm install -g @google/gemini-cli` or `npm install -g @github/copilot`), sign in (a Gemini API key, or `copilot login` in a terminal), and pick it as the agent for a new thread. Add others, such as Codex through `codex-acp`, with a name, the command (a name on PATH or a full path) and its arguments, or pick one under **From the ACP Registry**: each shows how to install it (a command to copy, or a download) and **Use** fills in the form with the registry's own command, which downloads the package the first time it starts. Nothing is installed or added until you do it. Restart Grove Bench after adding or removing one.

OpenCode (`opencode acp`) is built in too, for open models such as DeepSeek. It is in **alpha**: still being tested, so it stays out of the agent list until you tick **Enable OpenCode** in its group under [Grovekeepers (Agents)](#grovekeepers-agents), and it is marked Alpha where it shows. Claude Agent stays the default. Turning it off again only hides it for new threads; ones already on OpenCode keep working. Install it with `npm install -g opencode-ai`. It uses the providers you signed in to with `opencode auth login`, or save an OpenRouter API key under **Credentials**: new threads then start on DeepSeek V4.1 Flash through OpenRouter, and you can pick any other model OpenCode lists in the status bar. Grove Bench starts OpenCode so that it asks before it edits files, runs commands or fetches pages (so your mode and tool rules apply), so its own Plan mode can't edit files, and with a password on the local server OpenCode runs, which would otherwise let any program on this computer use it and read your saved keys. OpenCode's subagents are turned off, because their questions never reach Grove Bench and the turn would hang. A project's own `opencode.json` can still undo the asking in one case: a `"*": "allow"` rule for the build agent written after its other rules. If OpenCode then acts without asking, the thread says so.

With ACP agents:

- Grove Bench's memory and Preview browser tools are offered to every ACP agent. They are served on this computer only, with a key for each thread. Agents that can't connect to a server by address start a small bridge program that comes with Grove Bench
- Rewinding a thread starts the agent on a new session from that point, since ACP agents can't forget part of one
- Your mode and tool rules work on the requests an agent sends before it acts. If an agent edits a file or runs a command without asking, the thread says so once, since nothing Grove Bench does can stop it. Set the agent to ask first (for Gemini CLI, leave YOLO off)
- Skills, plugins and plan usage are not managed for them

## The gate (Permissions)

Control how the agent handles actions that need approval. The mode new threads start in is set per agent, under [Grovekeepers (Agents)](#grovekeepers-agents).

- **Tool allow rules** / **Tool deny rules**: Rules the app applies before the agent asks. Matching actions run without asking (allow) or are refused (deny), and deny rules win. A rule is `<tool>` or `<tool>(<glob>)`, where `<tool>` is a neutral keyword that works for every agent: `shell` (the glob matches the command, for both Bash and PowerShell), `edit` and `read` (the file path), `web` (the URL), `agent` (the sub-agent prompt), `question`, or `mcp` (the tool name after `mcp__`). A provider's own tool name also works, e.g. `PowerShell(git push *)` for PowerShell commands only. `*` matches anything. Examples: `shell(npm run *)`, `edit(src/**)`, `read(**/.env*)`, `web(*github.com*)`, `mcp(github__*)`. A rule that is already in the list can't be added twice
  - **Chained commands**: a shell command joined with `&&`, `||`, `;`, `|`, `|&`, `&` or a line break (in PowerShell: `;`, `|`, `&&`, `||` or a line break) is checked one part at a time. Allow rules must match every part, so `shell(npm run *)` approves `npm run lint && npm run test` but not `npm run build && rm -rf ~`. A deny rule applies if it matches any part
  - **Commands that can't be split safely**, such as ones using `$(...)`, backticks, `${...}`, `(...)` outside quotes, here-docs or `#` comments, are only approved by a rule for every shell command (`shell` or `shell(*)`), and only when you have no deny rule for shell commands. Otherwise the agent asks you
  - **PowerShell** commands also can't be split safely when they use `{...}` script blocks, `@(...)`, here-strings, the `&` call operator, typographic quotes, or a quote inside a word with a dash, such as `--format="%h %s"`. A backslash is a plain character in PowerShell, so `echo a\; b` is two commands
  - **Checking a rule**: when you add a rule, a rule that can never match, such as one with an unclosed bracket (`shell(rm *`), is refused with a note on how to fix it. A rule that looks like a slip but could be meant, such as a command with no brackets (`shell npm test`) or a word that isn't a keyword (`shel(npm *)`), shows a hint first; press **Add anyway** to keep it. Saved rules that can never match are marked with `!`
  - **Examples** under each list put a rule in the field for you to edit before adding it
  - **PowerShell aliases and case**: for PowerShell, deny rules ignore case and also catch a command's built-in aliases, so `shell(Remove-Item *)` denies `rm ~`, `del ~`, `ri ~`, `rd ~`, `erase ~`, `rmdir ~` and `remove-item ~`. Only the command name is expanded, not its parameters, so `shell(Remove-Item -Recurse *)` misses `rm -r ~`: write deny rules for the command name. Allow rules stay exact, so `shell(Get-ChildItem *)` doesn't approve `ls` or `get-childitem`. Add a rule for each spelling you want approved. Bash rules are always exact

## Branches & roots (Git & worktrees)

- **Default base branch**: The branch new worktrees start from (e.g. `main`). Leave it empty to use each project's default branch
- **Branch naming rule**: How to name a branch when a new thread starts without one, in your own words (e.g. `<type>/<ticket>-<short-description>`). Leave it empty to copy the style of the project's recent branch names
- **Auto-install dependencies**: Run `npm install` automatically when a worktree is created (off by default)

## Bells (Notifications)

- **Desktop notifications**: Native OS notifications, shown only while the window is unfocused: when an agent finishes a turn, when it's waiting on a permission or question, and on PR activity (new CI failures, review comments). Clicking a notification jumps to the thread
- **Flash the taskbar button**: The taskbar button also flashes; it stops as soon as the window regains focus
- **Badge the taskbar icon**: Show how many threads need you on the taskbar icon
- **Send a test notification**: Shows one straight away, even with the Grove Bench window in front. If it doesn't appear, Windows is holding it back: check **Settings > System > Notifications** in Windows, where Grove Bench needs to be allowed and **Do not disturb** (Focus assist on Windows 10) turned off

## Tending (Background work)

Memory, skill suggestions and thread goals run on each thread's own agent, using its background model (see [Grovekeepers (Agents)](#grovekeepers-agents)).

- **Auto-save project memory** and **Auto-compact project memory**: see [Project memory](memory.md)
- **Compaction timeout**: Stop a compaction pass, manual or automatic, that runs longer than this many seconds, from 30 to 3600 (an hour). A value saved outside that range is moved into it. Default 300 (5 minutes)
- **Suggest skills automatically**: After each finished turn, look for requests and commands you repeat and suggest skills for them. Each run is a model call. Off by default; the **Suggest** button in the status bar's Skills popover does the same on demand
- **Show the thread goal**: Pin one line at the top of the Thread tab saying what the thread is for, written after its first reply. Each goal is one model call, plus one each time you press **Refresh**. Off by default; see [Thread tab](thread-tab.md)
- **Sleep idle threads after**: After this many minutes idle (not open, not working, not waiting on you, no background task running), a thread's agent is shut down to save memory and CPU. The thread stays in the Threads list with its mode and "always allow" choices, and wakes when you open it or send it a message. Its terminal keeps running; the agent's page in the Preview tab closes. 0 turns it off. Default 30 minutes

## Tool shed (MCP servers)

View the MCP servers configured for an agent and add new ones without leaving the app:

- **Agent** picks whose servers to list, when more than one agent can manage MCP servers. It starts with the open thread's agent
- **Project** picks which project's servers to list. Project and local servers belong to one project, so the list starts with the open thread's project. Pick **None** to see only your user servers
- The list shows each configured server with its live health status (the check can take a few seconds)
- **Remove** asks you to confirm before it removes a server. Removing a project server changes the project's `.mcp.json`, which your team may share
- Servers the agent can't remove, such as a plugin's, show who owns them and how to turn them off instead. With Claude Agent: a plugin's servers are turned off under Plugins (Seed packets), and claude.ai connectors on claude.ai
- With agents that approve project servers before connecting them (Claude Agent does, for `.mcp.json`), an unapproved server shows **needs approval**. Threads don't connect it until you click **Approve**, which approves it for the project and its threads. Only approve servers you trust: they run on your machine
- **Add server** (top right of the section) opens a dialog to register a new server by name, transport (stdio command, HTTP, or SSE), and scope:
  - **User**: available in all projects on this machine
  - **Project**: shared with your team via `.mcp.json` in the chosen project's repository
  - **Local**: only this machine, only the chosen project
- stdio servers accept arguments and environment variables (one `KEY=value` per line); HTTP/SSE servers accept request headers (one per line)
- **Paste JSON** adds servers from a config you copied, such as a server's README or Claude Desktop's `mcpServers` block. It shows what it found before you add it
- If adding fails, the error shows in the dialog and what you typed stays, so you can fix it and try again. Once a server is added the dialog closes and the section says what was added
- New and restarted threads pick up added servers automatically; running threads must be restarted

## Seed packets (Plugins)

Browse and manage MCP server plugins that extend the agent's capabilities. Plugins can provide additional tools like web search, database access, or integration with external services. **Installed** lists yours, where you can turn each one off or remove it (Remove asks to confirm); **Discover** lists plugins you can install.

## Hedges (Privacy)

- **Send anonymous usage data**: Helps improve Grove Bench. No personal information or code is collected. Off unless you agree to it
- **Send crash reports**: When something goes wrong, send the error message and stack trace with the usage data. Needs usage data on. Never includes prompts, code or project paths
- **Look up agents and models online**: Once a day, download two public lists: the [ACP Registry](https://github.com/agentclientprotocol/registry) (agents that speak ACP, their latest versions and install commands) and [models.dev](https://models.dev) (each model's context size and price). The last copy is kept, so it works offline. Nothing about you or your projects is sent. On by default

## Field notes (Diagnostics)

For tracking down slowness. Nothing here leaves your computer.

- **Performance log**: freezes (when the app stopped responding, and what it was doing), how long each new thread, resume and wake took step by step, and a summary every 10 minutes are written to `performance.log` in the logs folder. **Show performance log** opens the folder with it selected. Send it along when reporting something slow
- **Record a performance trace**: records what every part of the app does for 10 seconds and saves it as a file. Start it, then do the slow thing, such as starting a new thread. Open the file at ui.perfetto.dev or in `chrome://tracing`. It holds timings, file paths and page addresses, not thread text. The newest 5 are kept
