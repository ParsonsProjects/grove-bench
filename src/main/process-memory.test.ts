import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
  agentProcesses, devServerProcesses, measureProcesses, parseTypeperf, resetNotedForTests, TYPEPERF_ARGS, TYPEPERF_TIMEOUT_MS,
  type ProcessSample,
} from './process-memory.js';

const MB = 1024 * 1024;

/** A process: `age` in seconds since it started. */
const p = (pid: number, ppid: number, name: string, mb: number, ageSec?: number): ProcessSample =>
  ({ pid, ppid, name, bytes: mb * MB, ...(ageSec !== undefined ? { ageSec } : {}) });

/** typeperf's output for these instances (name, pid, ppid, bytes, age): a
 *  blank line, the header (each counter for every instance, counter by
 *  counter, as typeperf orders them), one sample, then its closing words. */
function typeperfOutput(rows: [string, string, string, string, string][]): string {
  const counters = ['ID Process', 'Creating Process ID', 'Private Bytes', 'Elapsed Time'];
  const header = ['(PDH-CSV 4.0)', ...counters.flatMap((c) => rows.map(([name]) => `\\\\DESKTOP-1\\Process(${name})\\${c}`))];
  const values = ['10/20/2026 09:00:01.234', ...counters.flatMap((_, i) => rows.map((r) => r[i + 1]))];
  const csv = (fields: string[]) => fields.map((f) => `"${f}"`).join(',');
  return ['', csv(header), csv(values), '', 'Exiting, please wait...', 'The command completed successfully.', ''].join('\r\n');
}

describe('parseTypeperf', () => {
  it('reads every process: its pid, parent, private bytes and age', () => {
    const table = parseTypeperf(typeperfOutput([
      ['Idle', '0.000000', '0.000000', '61440.000000', '86400.000000'],
      ['System', '4.000000', '0.000000', '204800.000000', '86400.000000'],
      ['claude', '2210.000000', '1800.000000', '524288000.000000', '600.500000'],
      ['node', '4312.000000', '2210.000000', '1073741824.000000', '590.000000'],
      ['node#1', '4400.000000', '2210.000000', '104857600.000000', '580.000000'],
      ['Code - Insiders', '5000.000000', '4.000000', '1048576.000000', '100.000000'],
      ['_Total', '0.000000', '0.000000', '9999999999.000000', '86400.000000'],
    ]));
    expect(table).toEqual([
      { pid: 4, ppid: 0, name: 'system.exe', bytes: 204_800, ageSec: 86_400 },
      { pid: 2210, ppid: 1800, name: 'claude.exe', bytes: 500 * MB, ageSec: 600.5 },
      { pid: 4312, ppid: 2210, name: 'node.exe', bytes: 1024 * MB, ageSec: 590 },
      { pid: 4400, ppid: 2210, name: 'node.exe', bytes: 100 * MB, ageSec: 580 },
      { pid: 5000, ppid: 4, name: 'code - insiders.exe', bytes: MB, ageSec: 100 },
    ]);
  });

  it('leaves out a process that exited before the sample', () => {
    const table = parseTypeperf(typeperfOutput([
      ['node', '4312.000000', '2210.000000', '1048576.000000', '5.000000'],
      ['node#1', ' ', ' ', ' ', ' '],
    ]));
    expect(table?.map((e) => e.pid)).toEqual([4312]);
  });

  it('keeps a process whose memory or age is missing', () => {
    const table = parseTypeperf(typeperfOutput([
      ['node', '4312.000000', '2210.000000', ' ', ''],
      ['node#1', '4400.000000', '2210.000000', '1048576.000000', '-3.000000'],
    ]));
    expect(table).toEqual([
      { pid: 4312, ppid: 2210, name: 'node.exe', bytes: 0 },
      { pid: 4400, ppid: 2210, name: 'node.exe', bytes: MB },
    ]);
  });

  it('reads a decimal comma', () => {
    const table = parseTypeperf(typeperfOutput([['node', '4312,000000', '2210,000000', '1048576,000000', '5,500000']]));
    expect(table).toEqual([{ pid: 4312, ppid: 2210, name: 'node.exe', bytes: MB, ageSec: 5.5 }]);
  });

  it('is null when typeperf printed no sample', () => {
    expect(parseTypeperf('\r\nError: No valid counters.\r\n')).toBeNull();
    expect(parseTypeperf('\r\n"(PDH-CSV 4.0)","\\\\PC\\Process(node)\\ID Process"\r\n\r\nExiting, please wait...\r\n')).toBeNull();
  });

  it('builds the arguments for one sample of each counter', () => {
    expect(TYPEPERF_ARGS).toEqual([
      '\\Process(*)\\ID Process', '\\Process(*)\\Creating Process ID', '\\Process(*)\\Private Bytes', '\\Process(*)\\Elapsed Time',
      '-sc', '1',
    ]);
  });
});

describe('agentProcesses', () => {
  // The agent host (900) started two threads' agents (2210, 3300); 2210
  // started an MCP server through npx (cmd.exe > node.exe > node.exe) and a
  // shell, 3300 a node.exe of its own.
  const table = [
    p(900, 1, 'electron.exe', 40, 1000),
    p(2210, 900, 'claude.exe', 500, 600),
    p(2300, 2210, 'conhost.exe', 8, 600),
    p(2400, 2210, 'cmd.exe', 4, 590),
    p(2410, 2400, 'node.exe', 60, 590),
    p(2420, 2410, 'node.exe', 900, 589),
    p(2500, 2210, 'bash.exe', 6, 100),
    p(3300, 900, 'claude.exe', 450, 300),
    p(3400, 3300, 'node.exe', 200, 290),
    p(7000, 1, 'node.exe', 4000, 5000),
  ];
  const roots = [{ thread: 'aaaa1111', pid: 2210 }, { thread: 'bbbb2222', pid: 3300 }];

  it('sums every process under the agents by executable, largest first', () => {
    const memory = agentProcesses(table, roots);
    expect(memory.agents).toBe(2);
    expect(memory.untracked).toBe(0);
    expect(memory.byExe).toEqual([
      { name: 'node.exe', count: 3, bytes: 1160 * MB },
      { name: 'claude.exe', count: 2, bytes: 950 * MB },
      { name: 'conhost.exe', count: 1, bytes: 8 * MB },
      { name: 'bash.exe', count: 1, bytes: 6 * MB },
      { name: 'cmd.exe', count: 1, bytes: 4 * MB },
    ]);
  });

  it('lists the largest with their thread and the executables above them', () => {
    expect(agentProcesses(table, roots, undefined, 3).largest).toEqual([
      { name: 'node.exe', pid: 2420, bytes: 900 * MB, thread: 'aaaa1111', under: ['claude.exe', 'cmd.exe', 'node.exe'] },
      { name: 'claude.exe', pid: 2210, bytes: 500 * MB, thread: 'aaaa1111', under: [] },
      { name: 'claude.exe', pid: 3300, bytes: 450 * MB, thread: 'bbbb2222', under: [] },
    ]);
  });

  it('keeps the ends of a long chain', () => {
    const deep = [
      p(10, 1, 'claude.exe', 1), p(11, 10, 'bash.exe', 1), p(12, 11, 'bash.exe', 1),
      p(13, 12, 'cmd.exe', 1), p(14, 13, 'node.exe', 1), p(15, 14, 'node.exe', 1), p(16, 15, 'esbuild.exe', 50),
    ];
    expect(agentProcesses(deep, [{ thread: 't', pid: 10 }], undefined, 1).largest[0].under)
      .toEqual(['claude.exe', '…', 'cmd.exe', 'node.exe', 'node.exe']);
  });

  it("doesn't count an agent that has exited", () => {
    const memory = agentProcesses(table, [...roots, { thread: 'cccc3333', pid: 8800 }]);
    expect(memory.agents).toBe(2);
  });

  it("counts the agent host's other children as no thread's, and not the host", () => {
    const memory = agentProcesses(table, [roots[0]], 900);
    expect(memory.agents).toBe(1);
    expect(memory.untracked).toBe(1);
    expect(memory.byExe.find((e) => e.name === 'claude.exe')).toEqual({ name: 'claude.exe', count: 2, bytes: 950 * MB });
    expect(memory.byExe.find((e) => e.name === 'electron.exe')).toBeUndefined();
    expect(memory.largest.find((e) => e.pid === 3400)).toMatchObject({ thread: null, under: ['claude.exe'] });
  });

  it('skips a process whose parent PID was reused by a later process', () => {
    // 6000 is older than the agent: its parent was an earlier 2210.
    const memory = agentProcesses([...table, p(6000, 2210, 'node.exe', 3000, 5000)], roots);
    expect(memory.byExe[0]).toEqual({ name: 'node.exe', count: 3, bytes: 1160 * MB });
  });

  it("skips the agent host's children that are older than it", () => {
    const memory = agentProcesses([...table, p(6100, 900, 'node.exe', 3000, 5000)], roots, 900);
    expect(memory.untracked).toBe(0);
  });

  it('counts each process once, whatever the PIDs say', () => {
    // Without ages, a reused PID can make two processes each other's parent,
    // or put one thread's agent under another's.
    const cycle = [p(10, 20, 'claude.exe', 100), p(20, 10, 'node.exe', 50), p(30, 20, 'node.exe', 10), p(40, 40, 'node.exe', 5)];
    const memory = agentProcesses(cycle, [
      { thread: 'a', pid: 10 }, { thread: 'b', pid: 20 }, { thread: 'a', pid: 10 }, { thread: 'c', pid: 40 },
    ]);
    expect(memory.agents).toBe(2);
    expect(memory.byExe).toEqual([
      { name: 'claude.exe', count: 1, bytes: 100 * MB },
      { name: 'node.exe', count: 3, bytes: 65 * MB },
    ]);
  });

  it('is empty without agents', () => {
    expect(agentProcesses(table, [])).toEqual({ agents: 0, untracked: 0, byExe: [], largest: [] });
  });
});

describe('devServerProcesses', () => {
  // pwsh > npm (node) > cmd > dev script with Vite (node) > the app, which
  // started the agent host and an agent. Vite started esbuild.
  const table = [
    p(100, 50, 'pwsh.exe', 80, 99_000),
    p(200, 100, 'node.exe', 60, 90_000),
    p(210, 200, 'cmd.exe', 5, 90_000),
    p(220, 210, 'node.exe', 900, 89_990),
    p(230, 220, 'esbuild.exe', 30, 89_980),
    p(300, 220, 'electron.exe', 200, 89_900),
    p(310, 300, 'electron.exe', 50, 89_890),
    p(320, 310, 'claude.exe', 500, 1000),
  ];

  it('sums the npm and Vite processes above the app, leaving out the app and what it started', () => {
    expect(devServerProcesses(table, 300)).toEqual([
      { name: 'node.exe', count: 2, bytes: 960 * MB },
      { name: 'esbuild.exe', count: 1, bytes: 30 * MB },
      { name: 'cmd.exe', count: 1, bytes: 5 * MB },
    ]);
  });

  it('is null for an app not started by node', () => {
    expect(devServerProcesses([p(50, 4, 'explorer.exe', 100, 99_000), p(300, 50, 'grove bench.exe', 200, 10)], 300)).toBeNull();
    expect(devServerProcesses(table, 9999)).toBeNull();
  });

  it("stops at a parent PID that was reused, and doesn't loop on a cycle", () => {
    // Its parent 220 is younger than the app: an unrelated process.
    expect(devServerProcesses([p(220, 1, 'node.exe', 900, 5), p(300, 220, 'electron.exe', 200, 100)], 300)).toBeNull();
    const cycle = [p(220, 210, 'node.exe', 900), p(210, 220, 'cmd.exe', 5), p(300, 220, 'electron.exe', 200)];
    expect(devServerProcesses(cycle, 300)).toEqual([
      { name: 'node.exe', count: 1, bytes: 900 * MB },
      { name: 'cmd.exe', count: 1, bytes: 5 * MB },
    ]);
  });

  it('looks no further than npm', () => {
    // An agent's node.exe far above (a node-based shell) isn't the dev server.
    const deep = [
      p(10, 1, 'node.exe', 3000), p(11, 10, 'cmd.exe', 1), p(12, 11, 'cmd.exe', 1), p(13, 12, 'cmd.exe', 1),
      p(14, 13, 'cmd.exe', 1), p(15, 14, 'node.exe', 900), p(300, 15, 'electron.exe', 200),
    ];
    expect(devServerProcesses(deep, 300)).toEqual([{ name: 'node.exe', count: 1, bytes: 900 * MB }]);
  });
});

describe('measureProcesses', () => {
  // The dev script (300), the app (900), and an agent.
  const output = typeperfOutput([
    ['node', '300.000000', '200.000000', '104857600.000000', '2000.000000'],
    ['electron', '900.000000', '300.000000', '41943040.000000', '1000.000000'],
    ['claude', '2210.000000', '900.000000', '524288000.000000', '600.000000'],
    ['node#1', '2420.000000', '2210.000000', '943718400.000000', '500.000000'],
  ]);

  beforeEach(() => resetNotedForTests());

  it('lists processes with typeperf in the process host on Windows', async () => {
    const run = vi.fn(async () => ({ stdout: output }));
    const agents = vi.fn(() => [{ thread: 'aaaa1111', pid: 2210 }]);
    const memory = await measureProcesses({ agents, agentHostPid: () => 900, run, platform: 'win32' });

    expect(run).toHaveBeenCalledWith(expect.stringMatching(/\\System32\\typeperf\.exe$/i), TYPEPERF_ARGS, { timeout: TYPEPERF_TIMEOUT_MS });
    expect(agents.mock.invocationCallOrder[0]).toBeGreaterThan(run.mock.invocationCallOrder[0]);
    expect(memory).toEqual({
      agents: {
        agents: 1,
        untracked: 0,
        byExe: [{ name: 'node.exe', count: 1, bytes: 900 * MB }, { name: 'claude.exe', count: 1, bytes: 500 * MB }],
        largest: [
          { name: 'node.exe', pid: 2420, bytes: 900 * MB, thread: 'aaaa1111', under: ['claude.exe'] },
          { name: 'claude.exe', pid: 2210, bytes: 500 * MB, thread: 'aaaa1111', under: [] },
        ],
      },
      devServer: null,
    });
  });

  it('looks for the dev server when given the app', async () => {
    const memory = await measureProcesses({ agents: () => [], appPid: 900, run: async () => ({ stdout: output }), platform: 'win32' });
    expect(memory?.devServer).toEqual([{ name: 'node.exe', count: 1, bytes: 100 * MB }]);
  });

  it('runs nothing on other platforms', async () => {
    const run = vi.fn(async () => ({ stdout: output }));
    expect(await measureProcesses({ agents: () => [], run, platform: 'linux' })).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('is null when typeperf fails or prints no sample, noting only the first time', async () => {
    const note = vi.fn();
    const failing = vi.fn(async () => { throw new Error("The process host isn't running"); });
    expect(await measureProcesses({ agents: () => [], run: failing, platform: 'win32', note })).toBeNull();
    expect(await measureProcesses({ agents: () => [], run: async () => ({ stdout: 'Error: No valid counters.' }), platform: 'win32', note })).toBeNull();
    expect(note).toHaveBeenCalledOnce();
    expect(note.mock.calls[0][0]).toContain("The process host isn't running");
  });
});
