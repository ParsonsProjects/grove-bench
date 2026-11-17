/**
 * Made-up data for the agent monitor mockup (docs/agent-monitor-plan.md).
 * Shaped like what the real window would get from main: each thread's state
 * and current tool (messageStore), its subagents and background shells
 * (backgroundTaskStore), and its agent's process tree (process-memory.ts).
 * Thread names follow demo-mock.ts.
 */
import type { AgentSpriteState } from '$lib/agent-sprite.js';

export type AgentName = 'Claude Agent' | 'Gemini CLI' | 'OpenCode';

/** A tool call, with how long it runs in the mockup before the next. */
export interface MockCall {
  name: string;
  summary: string;
  seconds: number;
}

/** What a thread or subagent is doing between tool calls. */
export type Doing =
  | { kind: 'tool'; call: MockCall; startedAt: number }
  | { kind: 'thinking'; startedAt: number }
  | { kind: 'writing'; startedAt: number }
  | { kind: 'waiting'; prompt: string; startedAt: number }
  | { kind: 'idle' };

export interface DoneCall extends MockCall {
  /** In the mockup, when it finished. */
  endedAt: number;
  isError?: boolean;
}

export type TaskStatus = 'running' | 'stopping' | 'completed' | 'failed' | 'stopped';

export interface MockSubagent {
  /** Its Agent call's toolUseId. */
  id: string;
  /** The subagent type: Explore, general-purpose, ... */
  type: string;
  description: string;
  prompt: string;
  /** A background task the turn doesn't wait on: Stop works on it alone
   *  (stopTask). A foreground one stops only with its turn. */
  background: boolean;
  status: TaskStatus;
  doing: Doing;
  recent: DoneCall[];
  /** The calls it cycles through while running. */
  script: MockCall[];
  step: number;
  toolUses: number;
  tokens: number;
  startedAt: number;
}

export interface MockShell {
  taskId: string;
  /** The Monitor tool's watch, or a background shell (a dev server). */
  kind: 'shell' | 'monitor';
  description: string;
  status: TaskStatus;
  startedAt: number;
}

export interface MockProcess {
  pid: number;
  ppid: number;
  /** Executable only: Windows' counters give no command lines. */
  name: string;
  bytes: number;
  startedAt: number;
  /** Mockup only: started by the turn's own tool call, so it ends when the
   *  turn is interrupted. Real data can't say this (no tool call names its
   *  process), which is one of the gaps in docs/agent-monitor-plan.md. */
  endsWithTurn?: boolean;
}

export interface MockThread {
  id: string;
  title: string;
  project: string;
  branch: string;
  agent: AgentName;
  /** Whether the agent reports its subagents to Grove (ACP agents don't yet). */
  reportsSubagents: boolean;
  state: AgentSpriteState;
  doing: Doing;
  recent: DoneCall[];
  script: MockCall[];
  step: number;
  turnStartedAt?: number;
  turnTokens: number;
  error?: string;
  subagents: MockSubagent[];
  shells: MockShell[];
  /** The agent first, then what it started. Empty when it isn't running. */
  processes: MockProcess[];
}

const MB = 1024 * 1024;

export function mockThreads(now: number): MockThread[] {
  const s = (n: number) => now - n * 1000;
  const m = (n: number) => now - n * 60_000;
  return [
    {
      id: 's-sidebar',
      title: 'Sidebar revamp',
      project: 'grove-bench',
      branch: 'claude/sidebar-revamp',
      agent: 'Claude Agent',
      reportsSubagents: true,
      state: 'working',
      doing: { kind: 'tool', call: { name: 'Bash', summary: 'npm test -- src/renderer/components/Sidebar', seconds: 22 }, startedAt: s(14) },
      recent: [
        { name: 'Edit', summary: 'src/renderer/components/SidebarRow.svelte', seconds: 1, endedAt: s(20) },
        { name: 'Agent', summary: 'Explore: Find every caller of setActiveTab', seconds: 2, endedAt: s(41) },
        { name: 'Read', summary: 'src/renderer/stores/sessions.svelte.ts', seconds: 1, endedAt: s(55) },
        { name: 'Grep', summary: 'threadOpen', seconds: 1, endedAt: s(62) },
      ],
      script: [
        { name: 'Read', summary: 'src/renderer/components/Sidebar.svelte.test.ts', seconds: 3 },
        { name: 'Edit', summary: 'src/renderer/components/Sidebar.svelte', seconds: 2 },
        { name: 'Bash', summary: 'npx svelte-check --threshold error', seconds: 9 },
      ],
      step: 0,
      turnStartedAt: m(4),
      turnTokens: 48_200,
      subagents: [
        {
          id: 'toolu_explore_1',
          type: 'Explore',
          description: 'Find every caller of setActiveTab',
          prompt: 'Find every caller of messageStore.setActiveTab in src/renderer and say which pass a tab other than activity. Report file:line for each.',
          background: false,
          status: 'running',
          doing: { kind: 'tool', call: { name: 'Grep', summary: 'setActiveTab\\(', seconds: 5 }, startedAt: s(3) },
          recent: [
            { name: 'Glob', summary: 'src/renderer/**/*.svelte', seconds: 1, endedAt: s(6) },
            { name: 'Read', summary: 'src/renderer/stores/messages.svelte.ts', seconds: 1, endedAt: s(12) },
          ],
          script: [
            { name: 'Read', summary: 'src/renderer/components/StatusBarActivity.svelte', seconds: 3 },
            { name: 'Grep', summary: "setActiveTab\\(sessionId, '", seconds: 4 },
            { name: 'Read', summary: 'src/renderer/components/WorkspacePane.svelte', seconds: 3 },
          ],
          step: 0,
          toolUses: 11,
          tokens: 18_400,
          startedAt: s(41),
        },
        {
          id: 'toolu_gp_1',
          type: 'general-purpose',
          description: 'Check the light theme for the new badge colours',
          prompt: 'The sidebar now uses Badge tone="working". Check globals.css has a light value for every shade the new components use, run light-theme.test.ts and report what fails.',
          background: true,
          status: 'running',
          doing: { kind: 'tool', call: { name: 'Bash', summary: 'npx vitest run src/renderer/styles/light-theme.test.ts', seconds: 12 }, startedAt: s(7) },
          recent: [
            { name: 'Read', summary: 'src/renderer/styles/globals.css', seconds: 1, endedAt: s(9) },
          ],
          script: [
            { name: 'Read', summary: 'src/renderer/lib/components/ui/badge/variants.ts', seconds: 3 },
            { name: 'Grep', summary: 'status-working', seconds: 3 },
            { name: 'Bash', summary: 'npx vitest run src/renderer/styles', seconds: 10 },
          ],
          step: 0,
          toolUses: 4,
          tokens: 9_100,
          startedAt: m(2),
        },
      ],
      shells: [
        { taskId: 'b_dev', kind: 'shell', description: 'npm start', status: 'running', startedAt: m(38) },
        { taskId: 'b_watch', kind: 'monitor', description: 'Watch the Package workflow run for failures', status: 'running', startedAt: m(6) },
      ],
      processes: [
        { pid: 14820, ppid: 9120, name: 'claude.exe', bytes: 412 * MB, startedAt: m(52) },
        { pid: 15012, ppid: 14820, name: 'node.exe', bytes: 88 * MB, startedAt: m(52) },
        { pid: 15040, ppid: 14820, name: 'node.exe', bytes: 61 * MB, startedAt: m(52) },
        { pid: 17330, ppid: 14820, name: 'bash.exe', bytes: 6 * MB, startedAt: m(38) },
        { pid: 17344, ppid: 17330, name: 'node.exe', bytes: 74 * MB, startedAt: m(38) },
        { pid: 17391, ppid: 17344, name: 'node.exe', bytes: 196 * MB, startedAt: m(38) },
        { pid: 17402, ppid: 17391, name: 'esbuild.exe', bytes: 22 * MB, startedAt: m(38) },
        { pid: 20380, ppid: 14820, name: 'bash.exe', bytes: 6 * MB, startedAt: s(7) },
        { pid: 20388, ppid: 20380, name: 'node.exe', bytes: 182 * MB, startedAt: s(7) },
        { pid: 20450, ppid: 14820, name: 'bash.exe', bytes: 6 * MB, startedAt: s(14), endsWithTurn: true },
        { pid: 20461, ppid: 20450, name: 'node.exe', bytes: 304 * MB, startedAt: s(13), endsWithTurn: true },
        { pid: 20502, ppid: 14820, name: 'rg.exe', bytes: 14 * MB, startedAt: s(3), endsWithTurn: true },
      ],
    },
    {
      id: 's-oauth-ui',
      title: 'Sign-in retry banner',
      project: 'grove-bench',
      branch: 'claude/fix-oauth-refresh',
      agent: 'Claude Agent',
      reportsSubagents: true,
      state: 'permission',
      doing: { kind: 'waiting', prompt: 'Allow Bash: git push -u origin claude/fix-oauth-refresh?', startedAt: m(3) },
      recent: [
        { name: 'Bash', summary: 'git commit -m "Retry sign-in after a token refresh fails"', seconds: 2, endedAt: m(3) },
        { name: 'Bash', summary: 'npm run test:renderer -- SignIn', seconds: 31, endedAt: m(4) },
        { name: 'Edit', summary: 'src/renderer/components/SignInBanner.svelte', seconds: 1, endedAt: m(6) },
      ],
      script: [],
      step: 0,
      turnStartedAt: m(9),
      turnTokens: 31_700,
      subagents: [],
      shells: [],
      processes: [
        { pid: 11204, ppid: 9120, name: 'claude.exe', bytes: 377 * MB, startedAt: m(120) },
        { pid: 11290, ppid: 11204, name: 'node.exe', bytes: 59 * MB, startedAt: m(120) },
      ],
    },
    {
      id: 's-readme',
      title: 'Update README',
      project: 'grove-bench',
      branch: 'claude/update-readme',
      agent: 'Claude Agent',
      reportsSubagents: true,
      state: 'unread',
      doing: { kind: 'idle' },
      recent: [
        { name: 'Edit', summary: 'README.md', seconds: 1, endedAt: m(12) },
        { name: 'Read', summary: 'README.md', seconds: 1, endedAt: m(13) },
      ],
      script: [],
      step: 0,
      turnTokens: 12_900,
      subagents: [
        {
          id: 'toolu_explore_2',
          type: 'Explore',
          description: 'List the npm scripts and what each does',
          prompt: 'Read package.json and list each npm script with one line on what it does.',
          background: false,
          status: 'completed',
          doing: { kind: 'idle' },
          recent: [{ name: 'Read', summary: 'package.json', seconds: 1, endedAt: m(14) }],
          script: [],
          step: 0,
          toolUses: 3,
          tokens: 6_200,
          startedAt: m(15),
        },
      ],
      shells: [],
      processes: [
        { pid: 8840, ppid: 9120, name: 'claude.exe', bytes: 291 * MB, startedAt: m(47) },
      ],
    },
    {
      id: 's-oauth',
      title: 'Fix OAuth refresh',
      project: 'api-service',
      branch: 'claude/fix-oauth-refresh',
      agent: 'Gemini CLI',
      reportsSubagents: false,
      state: 'working',
      doing: { kind: 'thinking', startedAt: s(6) },
      recent: [
        { name: 'read_file', summary: 'src/auth/refresh.ts', seconds: 1, endedAt: s(8) },
        { name: 'search_file_content', summary: 'refreshToken', seconds: 1, endedAt: s(15) },
      ],
      script: [
        { name: 'read_file', summary: 'src/auth/session-store.ts', seconds: 2 },
        { name: 'replace', summary: 'src/auth/refresh.ts', seconds: 2 },
        { name: 'run_shell_command', summary: 'npm test -- auth', seconds: 14 },
      ],
      step: 0,
      turnStartedAt: m(2),
      turnTokens: 22_300,
      subagents: [],
      shells: [],
      processes: [
        { pid: 13377, ppid: 9120, name: 'node.exe', bytes: 258 * MB, startedAt: m(180) },
        { pid: 13410, ppid: 13377, name: 'node.exe', bytes: 44 * MB, startedAt: m(180) },
      ],
    },
    {
      id: 's-e2e',
      title: 'Flaky e2e retries',
      project: 'api-service',
      branch: 'claude/flaky-e2e-retries',
      agent: 'OpenCode',
      reportsSubagents: false,
      state: 'working',
      doing: { kind: 'tool', call: { name: 'bash', summary: 'npx playwright test e2e/login.spec.ts --repeat-each 5', seconds: 70 }, startedAt: s(48) },
      recent: [
        { name: 'edit', summary: 'e2e/login.spec.ts', seconds: 1, endedAt: s(52) },
        { name: 'bash', summary: 'npx playwright test e2e/login.spec.ts', seconds: 40, endedAt: m(2), isError: true },
      ],
      script: [
        { name: 'read', summary: 'playwright.config.ts', seconds: 2 },
        { name: 'edit', summary: 'e2e/helpers/wait-for-session.ts', seconds: 2 },
      ],
      step: 0,
      turnStartedAt: m(7),
      turnTokens: 40_800,
      subagents: [],
      shells: [],
      processes: [
        { pid: 16100, ppid: 9120, name: 'opencode.exe', bytes: 151 * MB, startedAt: m(38) },
        { pid: 19870, ppid: 16100, name: 'node.exe', bytes: 118 * MB, startedAt: s(48), endsWithTurn: true },
        { pid: 19901, ppid: 19870, name: 'chrome-headless-shell.exe', bytes: 142 * MB, startedAt: s(46), endsWithTurn: true },
        { pid: 19922, ppid: 19901, name: 'chrome-headless-shell.exe', bytes: 97 * MB, startedAt: s(46), endsWithTurn: true },
        { pid: 19935, ppid: 19901, name: 'chrome-headless-shell.exe', bytes: 63 * MB, startedAt: s(45), endsWithTurn: true },
      ],
    },
    {
      id: 's-perf',
      title: 'Perf audit',
      project: 'api-service',
      branch: 'claude/perf-audit',
      agent: 'Claude Agent',
      reportsSubagents: true,
      state: 'error',
      doing: { kind: 'idle' },
      error: 'The agent exited with code 1 during the turn.',
      recent: [
        { name: 'Bash', summary: 'npx autocannon -c 50 http://localhost:3000/health', seconds: 30, endedAt: m(21), isError: true },
      ],
      script: [],
      step: 0,
      turnTokens: 8_800,
      subagents: [],
      shells: [],
      processes: [],
    },
    {
      id: 's-rate',
      title: 'Rate limiter',
      project: 'api-service',
      branch: 'claude/rate-limiter',
      agent: 'Claude Agent',
      reportsSubagents: true,
      state: 'sleeping',
      doing: { kind: 'idle' },
      recent: [],
      script: [],
      step: 0,
      turnTokens: 0,
      subagents: [],
      shells: [],
      processes: [],
    },
  ];
}

/** The agent host the agents start from (process-host.ts). */
export const AGENT_HOST_PID = 9120;
