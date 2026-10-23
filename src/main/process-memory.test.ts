import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// Where typeperf runs when no `run` is given: the hosts, stood in for.
const hosts = vi.hoisted(() => ({ agentHostGaveUp: vi.fn(() => false), runProcessInHost: vi.fn(), runInAgentHost: vi.fn() }));
vi.mock('./process-host.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  agentHostGaveUp: hosts.agentHostGaveUp,
  runProcessInHost: hosts.runProcessInHost,
}));
vi.mock('./process-host-run.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runInAgentHost: hosts.runInAgentHost,
}));

import {
  agentProcesses, agentRoots, devServerProcesses, inconsistency, measureProcesses, parseTypeperf, resetForTests, typeperfArgs, windowsExeName,
  PROCESS_LEGACY, PROCESS_V2, SKIPPED, TYPEPERF_TIMEOUT_MS, V2_TIMEOUT_LIMIT, V2_UNREADABLE_LIMIT,
  type Counterset, type MeasureOptions, type ProcessSample,
} from './process-memory.js';

const MB = 1024 * 1024;

/** A process: `age` in seconds since it started. */
const p = (pid: number, ppid: number, name: string, mb: number, ageSec?: number): ProcessSample =>
  ({ pid, ppid, name, bytes: mb * MB, ...(ageSec !== undefined ? { ageSec } : {}) });

/** An instance as typeperf prints it: its name, then its pid, parent, private
 *  bytes and age as typeperf formats them. */
type Row = [string, string, string, string, string];
const n = (v: number) => `${v.toFixed(6)}`;
/** An instance from numbers: `mb` of private bytes, `age` in seconds. */
const row = (instance: string, pid: number, ppid: number, mb: number, age: number): Row =>
  [instance, n(pid), n(ppid), n(Math.round(mb * MB)), n(age)];

/**
 * typeperf's output for these instances: a blank line, the header (each
 * counter for every instance, counter by counter, as typeperf orders them),
 * one sample, then its closing words. `values` changes the sample's fields
 * as printed (the first is the time), to make one that doesn't hold together.
 */
function typeperfOutput(rows: Row[], { set = PROCESS_LEGACY, values = (v: string[]) => v }: { set?: Counterset; values?: (fields: string[]) => string[] } = {}): string {
  const counters = Object.values(set.counters);
  const header = ['(PDH-CSV 4.0) (GMT Daylight Time)(-60)', ...counters.flatMap((c) => rows.map(([name]) => `\\\\DESKTOP-1\\${set.object}(${name})\\${c}`))];
  const sample = ['10/23/2026 09:00:01.234', ...counters.flatMap((_, i) => rows.map((r) => r[i + 1]))];
  const csv = (fields: string[]) => fields.map((f) => `"${f}"`).join(',');
  return ['', csv(header), csv(values(sample)), '', 'Exiting, please wait...', 'The command completed successfully.', ''].join('\r\n');
}

/** The counters' order in typeperfOutput, by field. */
const COLUMN = { pid: 0, ppid: 1, bytes: 2, ageSec: 3 } as const;

/**
 * A sample whose values don't line up with the header after `instance`, as
 * when a process exits between typeperf listing the instances and sampling
 * them: its column is gone from each counter's values, those after it moved
 * up, the end blank. Every counter's values are off by a different count, so
 * one instance's ID, parent, memory and age belong to different processes.
 */
function shiftedAfter(rows: Row[], instance: string) {
  const at = rows.findIndex(([name]) => name === instance);
  return (fields: string[]) => {
    const kept = [fields[0]];
    for (let c = 0; c < 4; c++) kept.push(...fields.slice(1 + c * rows.length, 1 + (c + 1) * rows.length).filter((_, i) => i !== at));
    return [...kept, '', '', '', ''];
  };
}

/** A sample where the values under instances `a` and `b` are each other's,
 *  for `fields` only: same-named instances' numbers mixed up. */
function swapped(rows: Row[], a: string, b: string, fields: (keyof typeof COLUMN)[]) {
  const ia = rows.findIndex(([name]) => name === a);
  const ib = rows.findIndex(([name]) => name === b);
  return (values: string[]) => {
    const out = [...values];
    for (const f of fields) {
      const base = 1 + COLUMN[f] * rows.length;
      [out[base + ia], out[base + ib]] = [values[base + ib], values[base + ia]];
    }
    return out;
  };
}

describe('parseTypeperf', () => {
  it('reads every process: its pid, parent, private bytes and age', () => {
    const sample = parseTypeperf(typeperfOutput([
      ['Idle', '0.000000', '0.000000', '61440.000000', '86400.000000'],
      ['System', '4.000000', '0.000000', '204800.000000', '86400.000000'],
      ['claude', '2210.000000', '1800.000000', '524288000.000000', '600.500000'],
      ['node', '4312.000000', '2210.000000', '1073741824.000000', '590.000000'],
      ['node#1', '4400.000000', '2210.000000', '104857600.000000', '580.000000'],
      ['Code - Insiders', '5000.000000', '4.000000', '1048576.000000', '100.000000'],
      ['_Total', '0.000000', '0.000000', '9999999999.000000', '86400.000000'],
    ]));
    expect(sample).toEqual({
      processes: [
        { pid: 4, ppid: 0, name: 'system.exe', bytes: 204_800, ageSec: 86_400 },
        { pid: 2210, ppid: 1800, name: 'claude.exe', bytes: 500 * MB, ageSec: 600.5 },
        { pid: 4312, ppid: 2210, name: 'node.exe', bytes: 1024 * MB, ageSec: 590 },
        { pid: 4400, ppid: 2210, name: 'node.exe', bytes: 100 * MB, ageSec: 580 },
        { pid: 5000, ppid: 4, name: 'code - insiders.exe', bytes: MB, ageSec: 100 },
      ],
    });
  });

  it('leaves out a process that exited before the sample', () => {
    const sample = parseTypeperf(typeperfOutput([
      ['node', '4312.000000', '2210.000000', '1048576.000000', '5.000000'],
      ['node#1', ' ', ' ', ' ', ' '],
    ]));
    expect(sample?.processes.map((e) => e.pid)).toEqual([4312]);
    expect(sample?.problem).toBeUndefined();
  });

  it('keeps a process whose memory or age is missing', () => {
    const sample = parseTypeperf(typeperfOutput([
      ['node', '4312.000000', '2210.000000', ' ', ''],
      ['node#1', '4400.000000', '2210.000000', '1048576.000000', '-3.000000'],
    ]));
    expect(sample?.processes).toEqual([
      { pid: 4312, ppid: 2210, name: 'node.exe', bytes: 0 },
      { pid: 4400, ppid: 2210, name: 'node.exe', bytes: MB },
    ]);
  });

  it('reads a decimal comma', () => {
    const sample = parseTypeperf(typeperfOutput([['node', '4312,000000', '2210,000000', '1048576,000000', '5,500000']]));
    expect(sample?.processes).toEqual([{ pid: 4312, ppid: 2210, name: 'node.exe', bytes: MB, ageSec: 5.5 }]);
  });

  it('is null when typeperf printed no sample of those counters', () => {
    expect(parseTypeperf('\r\nError: No valid counters.\r\n')).toBeNull();
    expect(parseTypeperf('\r\n"(PDH-CSV 4.0)","\\\\PC\\Process(node)\\ID Process"\r\n\r\nExiting, please wait...\r\n')).toBeNull();
    // The Process counterset's sample isn't one of Process V2, nor the other way round.
    const legacy = typeperfOutput([row('node', 4312, 2210, 1, 5)]);
    expect(parseTypeperf(legacy, PROCESS_V2)).toBeNull();
    expect(parseTypeperf(typeperfOutput([row('node:4312', 4312, 2210, 1, 5)], { set: PROCESS_V2 }), PROCESS_LEGACY)).toBeNull();
  });

  it('says when the sample has a value too few or too many for its counters', () => {
    const rows = [row('node', 4312, 2210, 1, 5), row('node#1', 4400, 2210, 1, 5)];
    expect(parseTypeperf(typeperfOutput(rows, { values: (v) => v.slice(0, -1) }))?.problem).toBe('7 values for 8 counters');
    expect(parseTypeperf(typeperfOutput(rows, { values: (v) => [...v, '1.000000'] }))?.problem).toBe('9 values for 8 counters');
  });

  it('builds the arguments for one sample of each counter, Process V2 first', () => {
    expect(typeperfArgs(PROCESS_V2)).toEqual([
      '\\Process V2(*)\\Process ID', '\\Process V2(*)\\Creating Process ID', '\\Process V2(*)\\Private Bytes', '\\Process V2(*)\\Elapsed Time',
      '-sc', '1',
    ]);
    expect(typeperfArgs(PROCESS_LEGACY)).toEqual([
      '\\Process(*)\\ID Process', '\\Process(*)\\Creating Process ID', '\\Process(*)\\Private Bytes', '\\Process(*)\\Elapsed Time',
      '-sc', '1',
    ]);
  });
});

// ASSUMED FORMAT: Process V2's instance names as name:pid, which is how
// Prometheus's windows_exporter reads them (it cuts the name at the first
// colon); its counter names as windows_exporter's perfDataCounterValuesV2
// names them. Not checked against a real Windows 11 typeperf here.
describe('parseTypeperf with Process V2', () => {
  const v2 = (rows: Row[], values?: (fields: string[]) => string[]) => parseTypeperf(typeperfOutput(rows, { set: PROCESS_V2, values }), PROCESS_V2);

  it('reads each process by an instance of its own, the name without its pid', () => {
    expect(v2([
      row('Idle:0', 0, 0, 0, 86_400),
      row('_Total:0', 0, 0, 9000, 86_400),
      row('System:4', 4, 0, 0.25, 86_400),
      row('Grove Bench:800', 800, 6000, 210, 2000),
      row('claude:2210', 2210, 900, 500, 600),
      row('conhost:2211', 2211, 2210, 8, 600),
      row('conhost:3301', 3301, 3300, 8, 300),
      row('Code - Insiders:5000', 5000, 4, 1, 100),
    ])).toEqual({
      processes: [
        p(4, 0, 'system.exe', 0.25, 86_400),
        p(800, 6000, 'grove bench.exe', 210, 2000),
        p(2210, 900, 'claude.exe', 500, 600),
        p(2211, 2210, 'conhost.exe', 8, 600),
        p(3301, 3300, 'conhost.exe', 8, 300),
        p(5000, 4, 'code - insiders.exe', 1, 100),
      ],
    });
  });

  it("reads the instance name as a key only: a pid beside it in another form, or none, still names the executable", () => {
    expect(v2([
      row('node_4312', 4312, 2210, 1, 5),
      row('node (4400)', 4400, 2210, 1, 5),
      row('4500:node.exe', 4500, 2210, 1, 5),
      row('rg', 4600, 2210, 1, 5),
    ])?.processes.map((e) => e.name)).toEqual(['node.exe', 'node.exe', 'node.exe', 'rg.exe']);
  });

  it("says when an instance's name holds another process's ID", () => {
    expect(v2([row('claude:2210', 2210, 900, 500, 600), row('conhost:2211', 3301, 3300, 8, 300)])?.problem)
      .toBe('instance conhost:2211 has process ID 3301');
  });

  it('takes a pid from a name only where it is the whole number beside the separator', () => {
    expect(v2([
      row('node 007', 7, 2210, 1, 5),
      row('app-2-4312', 4312, 2210, 1, 5),
      row('x_14312', 4313, 2210, 1, 5),
      row('45001:node', 4500, 2210, 1, 5),
    ])?.processes.map((e) => e.name)).toEqual(['node 007.exe', 'app-2.exe', 'x_14312.exe', '45001:node.exe']);
  });
});

describe('parseTypeperf builds no regular expressions as it reads', () => {
  it('none per sample or per instance: they are built once, with the module', () => {
    const output = typeperfOutput(Array.from({ length: 200 }, (_, i) => row(`node${i ? `#${i}` : ''}`, 1000 + i, 900, 10, 5)));
    const v2Output = typeperfOutput(Array.from({ length: 200 }, (_, i) => row(`node:${1000 + i}`, 1000 + i, 900, 10, 5)), { set: PROCESS_V2 });
    // Counts calls of the RegExp constructor: `new RegExp(...)` in the
    // code, as exeOf() made two of per instance.
    const real = globalThis.RegExp;
    let built = 0;
    globalThis.RegExp = new Proxy(real, {
      construct(target, args) { built++; return Reflect.construct(target, args); },
      apply(target, self, args) { built++; return Reflect.apply(target, self, args); },
    });
    let read: unknown[];
    try {
      read = [parseTypeperf(output)?.processes.length, parseTypeperf(v2Output, PROCESS_V2)?.processes.length, windowsExeName('C:\\Apps\\Grove Bench\\Grove Bench.exe')];
    } finally {
      globalThis.RegExp = real;
    }
    expect(read).toEqual([200, 200, 'grove bench.exe']);
    expect(built).toBe(0);
  });
});

describe('windowsExeName', () => {
  it('names the executable as the process list does: lowercase, no folder, .exe', () => {
    expect(windowsExeName('C:\\Program Files\\Grove Bench\\Grove Bench.exe')).toBe('grove bench.exe');
    expect(windowsExeName('C:\\Apps\\x\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\Claude.EXE')).toBe('claude.exe');
    expect(windowsExeName('/repo/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude')).toBe('claude.exe');
    // Node, as the tests run, and Electron, as the app does.
    expect(windowsExeName('/usr/local/bin/node')).toBe('node.exe');
    expect(windowsExeName('C:\\repo\\node_modules\\electron\\dist\\electron.exe')).toBe('electron.exe');
    expect(windowsExeName('node')).toBe('node.exe');
  });

  it('adds .exe to a name with dots in it, as Windows starts it', () => {
    expect(windowsExeName('C:\\tools\\claude-2.1.0')).toBe('claude-2.1.0.exe');
    expect(windowsExeName('C:\\tools\\claude-2.1.0.exe')).toBe('claude-2.1.0.exe');
    expect(windowsExeName('Microsoft.Photos')).toBe('microsoft.photos.exe');
  });

  it('names a path as typeperf names its process, in either counterset', () => {
    for (const [file, legacy] of [
      ['C:\\Program Files\\Grove Bench\\Grove Bench.exe', 'Grove Bench'],
      ['C:\\tools\\Claude-2.1.0.EXE', 'Claude-2.1.0'],
      ['C:\\repo\\node_modules\\electron\\dist\\electron.exe', 'electron#2'],
    ]) {
      const listed = parseTypeperf(typeperfOutput([row(legacy, 4312, 900, 1, 5)]))!.processes[0].name;
      const listedV2 = parseTypeperf(typeperfOutput([row(`${legacy.replace(/#\d+$/, '')}:4312`, 4312, 900, 1, 5)], { set: PROCESS_V2 }), PROCESS_V2)!.processes[0].name;
      expect([listed, listedV2]).toEqual([windowsExeName(file), windowsExeName(file)]);
    }
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
    expect(agentProcesses(table, roots, { top: 3 }).largest).toEqual([
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
    expect(agentProcesses(deep, [{ thread: 't', pid: 10 }], { top: 1 }).largest[0].under)
      .toEqual(['claude.exe', '…', 'cmd.exe', 'node.exe', 'node.exe']);
  });

  it("doesn't count an agent that has exited", () => {
    const memory = agentProcesses(table, [...roots, { thread: 'cccc3333', pid: 8800 }]);
    expect(memory.agents).toBe(2);
  });

  it("counts the agent host's other children as no thread's, and not the host", () => {
    const memory = agentProcesses(table, [roots[0]], { hostPid: 900 });
    expect(memory.agents).toBe(1);
    expect(memory.untracked).toBe(1);
    expect(memory.byExe.find((e) => e.name === 'claude.exe')).toEqual({ name: 'claude.exe', count: 2, bytes: 950 * MB });
    expect(memory.byExe.find((e) => e.name === 'electron.exe')).toBeUndefined();
    expect(memory.largest.find((e) => e.pid === 3400)).toMatchObject({ thread: null, under: ['claude.exe'] });
  });

  describe('leaves out the commands the agent host ran for the app, and what they started', () => {
    // gh and the git it started, a claude CLI call through cmd.exe, and
    // typeperf with its console host: the agent host's children, not agents.
    const commands = [
      p(9000, 900, 'typeperf.exe', 3, 1), p(9001, 9000, 'conhost.exe', 6, 1),
      p(9100, 900, 'gh.exe', 30, 4), p(9110, 9100, 'git.exe', 12, 3),
      p(9200, 900, 'cmd.exe', 4, 8), p(9210, 9200, 'claude.exe', 300, 8),
    ];
    const withCommands = [...table, ...commands];

    it('by pid, whatever their executable', () => {
      const memory = agentProcesses(withCommands, roots, { hostPid: 900, commands: new Set([9000, 9100, 9200]) });
      expect(memory).toEqual(agentProcesses(table, roots, { hostPid: 900 }));
      expect(memory.untracked).toBe(0);
      expect(memory.byExe.find((e) => e.name === 'conhost.exe')).toEqual({ name: 'conhost.exe', count: 1, bytes: 8 * MB });
    });

    it('and only those: the rest count as agents no thread claims, typeperf too', () => {
      const memory = agentProcesses(withCommands, roots, { hostPid: 900, commands: new Set([9100]) });
      expect(memory.untracked).toBe(2);
      expect(memory.byExe.find((e) => e.name === 'typeperf.exe')).toEqual({ name: 'typeperf.exe', count: 1, bytes: 3 * MB });
      expect(memory.byExe.find((e) => e.name === 'gh.exe')).toBeUndefined();
      expect(memory.byExe.find((e) => e.name === 'git.exe')).toBeUndefined();
    });

    it("but a thread's agent with a pid a command had during the sample is still its agent", () => {
      expect(agentProcesses(table, roots, { hostPid: 900, commands: new Set([3300]) })).toEqual(agentProcesses(table, roots, { hostPid: 900 }));
    });
  });

  it('skips a process whose parent PID was reused by a later process', () => {
    // 6000 is older than the agent: its parent was an earlier 2210.
    const memory = agentProcesses([...table, p(6000, 2210, 'node.exe', 3000, 5000)], roots);
    expect(memory.byExe[0]).toEqual({ name: 'node.exe', count: 3, bytes: 1160 * MB });
  });

  it("skips the agent host's children that are older than it", () => {
    const memory = agentProcesses([...table, p(6100, 900, 'node.exe', 3000, 5000)], roots, { hostPid: 900 });
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

describe('agentRoots', () => {
  it("counts the threads' agents that are running, each once, and sums their own memory, not what they started", () => {
    const table = [p(2210, 900, 'claude.exe', 500, 600), p(2420, 2210, 'node.exe', 900, 589), p(3300, 900, 'claude.exe', 450, 300)];
    expect(agentRoots(table, [
      { thread: 'a', pid: 2210 }, { thread: 'b', pid: 3300 }, { thread: 'a', pid: 2210 }, { thread: 'c', pid: 8800 },
    ])).toEqual({ agents: 2, ownBytes: 950 * MB });
    expect(agentRoots(table, [])).toEqual({ agents: 0, ownBytes: 0 });
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

/**
 * A busy PC, as the Process counterset lists it: the packaged app (800), its
 * agent host (900) and git host (905); four threads' Claude Code agents, each
 * with its console host, one with an MCP server through npx; an ACP agent
 * started through its .cmd shim (cmd.exe); typeperf, listing them; and the
 * rest of the PC (chrome, firefox, svchost, keyboxd, MoUsoCoreWorker), with a
 * console of its own.
 */
const busy: Row[] = [
  row('System', 4, 0, 0.2, 86_400),
  row('services', 600, 500, 8, 86_400),
  row('svchost', 700, 600, 30, 86_400),
  row('svchost#1', 710, 600, 67, 86_000),
  row('explorer', 6000, 5900, 120, 80_000),
  row('chrome', 7000, 6000, 380, 50_000),
  row('chrome#1', 7010, 7000, 150, 50_000),
  row('firefox', 7200, 6000, 45, 40_000),
  row('firefox#1', 7210, 7200, 45, 40_000),
  row('firefox#2', 7220, 7200, 45, 40_000),
  row('keyboxd', 7300, 600, 6, 86_000),
  row('MoUsoCoreWorker', 7100, 700, 40, 3000),
  row('cmd', 6050, 6000, 4, 20_000),
  row('conhost', 6051, 6050, 7, 20_000),
  row('Grove Bench', 800, 6000, 210, 2000),
  row('Grove Bench#1', 900, 800, 40, 1990),
  row('Grove Bench#2', 905, 800, 35, 1990),
  row('claude', 2210, 900, 520, 1800),
  row('conhost#1', 2211, 2210, 8, 1800),
  row('cmd#1', 2300, 2210, 4, 1790),
  row('node', 2310, 2300, 60, 1790),
  row('node#1', 2320, 2310, 400, 1789),
  row('claude#1', 3300, 900, 480, 1500),
  row('conhost#2', 3301, 3300, 8, 1500),
  row('claude#2', 4400, 900, 450, 1200),
  row('conhost#3', 4401, 4400, 8, 1200),
  row('claude#3', 5500, 900, 300, 600),
  row('conhost#4', 5501, 5500, 8, 600),
  row('cmd#2', 5600, 900, 4, 500),
  row('node#2', 5610, 5600, 150, 500),
  row('typeperf', 9000, 900, 3, 1),
  row('conhost#5', 9001, 9000, 6, 1),
];
const busyRoots = [
  { thread: 'aaaa1111', pid: 2210, exe: 'claude.exe' },
  { thread: 'bbbb2222', pid: 3300, exe: 'claude.exe' },
  { thread: 'cccc3333', pid: 4400, exe: 'claude.exe' },
  { thread: 'dddd4444', pid: 5500, exe: 'claude.exe' },
  // An ACP agent: the adapter doesn't say what it runs as.
  { thread: 'eeee5555', pid: 5600 },
];
const main = { pid: 800, exe: 'grove bench.exe' };
const anchors = { roots: busyRoots, hostPid: 900, main };
const tableOf = (output: string) => parseTypeperf(output)!.processes;

describe('inconsistency', () => {
  it('passes a sample that holds together', () => {
    expect(inconsistency(tableOf(typeperfOutput(busy)), anchors)).toBeUndefined();
  });

  it("passes one taken before an agent started, or whose agents' parents have exited", () => {
    // 7700 started after the sample. The MCP server's cmd.exe (2300) exited,
    // and a later process has its pid.
    const later = busy.map((r) => (r[0] === 'cmd#1' ? row('cmd#1', 2300, 6000, 4, 5) : r));
    expect(inconsistency(tableOf(typeperfOutput(later)), { ...anchors, roots: [...busyRoots, { thread: 'ffff6666', pid: 7700, exe: 'claude.exe' }] })).toBeUndefined();
  });

  it("passes one whose agents the app started itself, or whose agents' parents it can't know", () => {
    // Started here while the agent host was down; it's up again now.
    const table = [p(800, 6000, 'grove bench.exe', 210, 2000), p(900, 800, 'grove bench.exe', 40, 50), p(2210, 800, 'claude.exe', 500, 60)];
    expect(inconsistency(table, { roots: [busyRoots[0]], hostPid: 900, main })).toBeUndefined();
    // The agent host restarting, its pid unknown: an agent still under the
    // one before, or without the app to check against, only their names are.
    const before = [...table, p(3300, 950, 'claude.exe', 400, 55)];
    expect(inconsistency(before, { roots: busyRoots.slice(0, 2), main })).toBeUndefined();
    expect(inconsistency(before, { roots: busyRoots.slice(0, 2) })).toBeUndefined();
    expect(inconsistency([...before, p(4400, 950, 'conhost.exe', 8, 55)], { roots: busyRoots.slice(0, 3) }))
      .toBe("thread cccc3333's agent (pid 4400) is listed as conhost.exe, not claude.exe");
  });

  it('fails one that lists a pid twice', () => {
    const twice = (values: string[]) => { const out = [...values]; out[1 + busy.findIndex(([name]) => name === 'conhost#3')] = n(3301); return out; };
    expect(inconsistency(tableOf(typeperfOutput(busy, { values: twice })), anchors)).toBe('pid 3301 is listed twice, as conhost.exe and conhost.exe');
  });

  it("fails one that names the app, or its agent host, as something else, or puts the host under another process", () => {
    const renamed = (from: string, to: string) => busy.map((r): Row => (r[0] === from ? [to, ...r.slice(1)] as Row : r));
    expect(inconsistency(tableOf(typeperfOutput(renamed('Grove Bench', 'svchost#9'))), anchors))
      .toBe("the app's own process (pid 800) is listed as svchost.exe, not grove bench.exe");
    expect(inconsistency(tableOf(typeperfOutput(renamed('Grove Bench#1', 'conhost#9'))), anchors))
      .toBe('the agent host (pid 900) is listed as conhost.exe, not grove bench.exe');
    expect(inconsistency(tableOf(typeperfOutput(busy, { values: swapped(busy, 'Grove Bench#1', 'svchost#1', ['ppid']) })), anchors))
      .toBe("the agent host (pid 900) is listed under pid 600, not the app's own process");
    expect(inconsistency([], anchors)).toBe("the app's own process (pid 800) isn't in it");
  });

  it("fails one that names a Claude Code thread's agent as something else", () => {
    expect(inconsistency(tableOf(typeperfOutput(busy, { values: swapped(busy, 'claude#2', 'conhost#3', ['pid', 'ppid', 'ageSec']) })), anchors))
      .toBe("thread cccc3333's agent (pid 4400) is listed as conhost.exe, not claude.exe");
  });

  it("fails one that puts a thread's agent under another process, or under a younger one", () => {
    // The ACP agent, whose executable the check doesn't know.
    expect(inconsistency(tableOf(typeperfOutput(busy, { values: swapped(busy, 'cmd#2', 'cmd', ['ppid']) })), anchors))
      .toBe("thread eeee5555's agent (pid 5600) is listed under pid 6000 (explorer.exe), not the agent host or the app");
    expect(inconsistency(tableOf(typeperfOutput(busy, { values: swapped(busy, 'cmd#2', 'firefox#2', ['ageSec']) })), anchors))
      .toBe("thread eeee5555's agent (pid 5600) is listed under pid 900 (grove bench.exe), not the agent host or the app");
  });
});

describe('measureProcesses', () => {
  /** The same processes as Process V2 lists them, each named name:pid. */
  const toV2 = (rows: Row[]) => rows.map(([instance, ...values]) => [`${instance.replace(/#\d+$/, '')}:${Number(values[0])}`, ...values] as Row);
  const v2Rows: Row[] = toV2(busy);
  const v2Output = typeperfOutput(v2Rows, { set: PROCESS_V2 });
  const legacyOutput = typeperfOutput(busy);
  const isV2 = (args: string[]) => args[0].startsWith('\\Process V2(');
  /** typeperf turning a counterset down: it prints why and exits with an error. */
  const turnedDown = () => Object.assign(new Error('Command failed with exit code 1: typeperf.exe'), {
    exitCode: 1, stdout: '\r\nError: No valid counters.\r\n', stderr: '', failed: true, timedOut: false,
  });
  const timedOut = () => Object.assign(new Error('Command timed out after 30000 milliseconds: typeperf.exe'), { timedOut: true });
  /** typeperf as Windows 11 runs it, or as Windows 10 does (no Process V2). */
  const windows11 = vi.fn(async (_file: string, args: string[]) => ({ stdout: isV2(args) ? v2Output : legacyOutput }));
  /** Windows 10's typeperf, its Process counters printing `output`. */
  const windowsWith = (output: string) => vi.fn(async (_file: string, args: string[]) => {
    if (isV2(args)) throw turnedDown();
    return { stdout: output };
  });
  const windows10 = windowsWith(legacyOutput);
  /** typeperf's own pid in `busy`, which the agent host ran meanwhile. */
  const TYPEPERF_PID = 9000;
  const measure = (run: MeasureOptions['run'], extra: Partial<MeasureOptions> = {}) => measureProcesses({
    agents: () => busyRoots, agentHostPid: () => 900, main, run, recordCommandPids: () => () => new Set([TYPEPERF_PID]), platform: 'win32', note: () => {}, ...extra,
  });
  /** Which counters each typeperf run read. */
  const read = (run: { mock: { calls: [string, string[], ...unknown[]][] } }) => run.mock.calls.map(([, args]) => (isV2(args) ? 'Process V2' : 'Process'));
  const switched = (note: { mock: { calls: unknown[][] } }) => note.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('from now on, not Process V2'));

  beforeEach(() => {
    resetForTests();
    windows11.mockClear();
    windows10.mockClear();
  });

  const expected = {
    counters: 'Process V2',
    agents: {
      agents: 5,
      untracked: 0,
      byExe: [
        { name: 'claude.exe', count: 4, bytes: 1750 * MB },
        { name: 'node.exe', count: 3, bytes: 610 * MB },
        { name: 'conhost.exe', count: 4, bytes: 32 * MB },
        { name: 'cmd.exe', count: 2, bytes: 8 * MB },
      ],
      largest: [
        { name: 'claude.exe', pid: 2210, bytes: 520 * MB, thread: 'aaaa1111', under: [] },
        { name: 'claude.exe', pid: 3300, bytes: 480 * MB, thread: 'bbbb2222', under: [] },
        { name: 'claude.exe', pid: 4400, bytes: 450 * MB, thread: 'cccc3333', under: [] },
        { name: 'node.exe', pid: 2320, bytes: 400 * MB, thread: 'aaaa1111', under: ['claude.exe', 'cmd.exe', 'node.exe'] },
        { name: 'claude.exe', pid: 5500, bytes: 300 * MB, thread: 'dddd4444', under: [] },
      ],
    },
    devServer: null,
  };
  /** The same PC from the Process counterset: only what its checks vouch
   *  for, the threads' agents themselves (520 + 480 + 450 + 300 + 4 MB). */
  const expectedLegacy = { counters: 'Process', agents: { agents: 5, ownBytes: 1754 * MB }, devServer: null };

  it('lists processes with typeperf in the agent host, never the main process, reading Process V2 where Windows has it', async () => {
    const agents = vi.fn(() => busyRoots);
    expect(await measure(windows11, { agents })).toEqual(expected);
    expect(windows11).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\\System32\\typeperf\.exe$/i), typeperfArgs(PROCESS_V2), { timeout: TYPEPERF_TIMEOUT_MS, hostOnly: true },
    );
    expect(agents.mock.invocationCallOrder[0]).toBeGreaterThan(windows11.mock.invocationCallOrder[0]);

    expect(await measure(windows11)).toEqual(expected);
    expect(windows11.mock.calls.map(([, args]) => args)).toEqual([typeperfArgs(PROCESS_V2), typeperfArgs(PROCESS_V2)]);
  });

  it('leaves the commands the agent host ran meanwhile out of the agents: typeperf itself, gh and the git it started', async () => {
    const withGh = typeperfOutput([...v2Rows, row('gh:9100', 9100, 900, 30, 4), row('git:9110', 9110, 9100, 12, 3)], { set: PROCESS_V2 });
    const run = vi.fn(async () => ({ stdout: withGh }));
    const stop = vi.fn(() => new Set([TYPEPERF_PID, 9100]));
    const record = vi.fn(() => stop);
    expect(await measure(run, { recordCommandPids: record })).toEqual(expected);
    // Recorded from before typeperf started to after it closed.
    expect(record.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);
    expect(stop).toHaveBeenCalled();

    // Unrecorded, they'd count as agents no thread claims.
    expect(await measure(run, { recordCommandPids: () => () => new Set() })).toMatchObject({
      agents: { untracked: 2, byExe: expect.arrayContaining([{ name: 'gh.exe', count: 1, bytes: 30 * MB }, { name: 'typeperf.exe', count: 1, bytes: 3 * MB }]) },
    });
  });

  it("reads the Process counters once typeperf says there's no Process V2, and asks for it no more", async () => {
    const note = vi.fn();
    expect(await measure(windows10, { note })).toEqual(expectedLegacy);
    expect(await measure(windows10, { note })).toEqual(expectedLegacy);
    expect(read(windows10)).toEqual(['Process V2', 'Process', 'Process']);
    expect(note).toHaveBeenCalledOnce();
    expect(note.mock.calls[0][0]).toMatch(/from now on, not Process V2 \(typeperf says there are no such counters, as on Windows 10: Error: No valid counters\.\); from those the health line gives only the threads' agents/);
  });

  it('takes PDH\'s "no such object" exit code from typeperf for no Process V2 too', async () => {
    for (const exitCode of [0xC0000BB8, -1073738824]) {
      resetForTests();
      const run = vi.fn(async (_file: string, args: string[]) => {
        if (isV2(args)) throw Object.assign(new Error(`Command failed with exit code ${exitCode}: typeperf.exe`), { exitCode, stdout: '', stderr: '' });
        return { stdout: legacyOutput };
      });
      expect(await measure(run)).toEqual(expectedLegacy);
      expect(read(run)).toEqual(['Process V2', 'Process']);
    }
  });

  it(`tries Process V2 again after a read with no sample in it, and gives it up after ${V2_UNREADABLE_LIMIT} in a row, noted once`, async () => {
    const noSample = async () => ({ stdout: '\r\n"(PDH-CSV 4.0) (GMT Daylight Time)(-60)"\r\n"10/23/2026 09:00:01.234"\r\n' });
    const notValid = async () => { throw Object.assign(new Error('Command failed with exit code 1: typeperf.exe'), { exitCode: 1, stdout: '\r\nError: The data is not valid.\r\n', stderr: '' }); };
    const good = async () => ({ stdout: v2Output });
    const answers = [noSample, notValid, good, noSample, notValid, noSample];
    const run = vi.fn(async (_file: string, args: string[]) => (isV2(args) ? answers.shift()!() : { stdout: legacyOutput }));
    const note = vi.fn();
    // Each skips its period, until a good one starts the count again.
    expect(await measure(run, { note })).toBeNull();
    expect(await measure(run, { note })).toBeNull();
    expect(await measure(run, { note })).toEqual(expected);
    expect(await measure(run, { note })).toBeNull();
    expect(await measure(run, { note })).toBeNull();
    expect(switched(note)).toEqual([]);
    // The third in a row: the Process counters, at once and from now on.
    expect(await measure(run, { note })).toEqual(expectedLegacy);
    expect(await measure(run, { note })).toEqual(expectedLegacy);
    expect(read(run)).toEqual([...Array(6).fill('Process V2'), 'Process', 'Process']);
    expect(switched(note)).toEqual([expect.stringContaining(`typeperf printed no sample of them ${V2_UNREADABLE_LIMIT} times in a row: "(PDH-CSV 4.0)`)]);
  });

  it(`reads the Process counters once reading Process V2 has timed out ${V2_TIMEOUT_LIMIT} times in a row, noted once`, async () => {
    const answers = [timedOut, () => ({ stdout: v2Output }), timedOut, timedOut];
    const run = vi.fn(async (_file: string, args: string[]) => {
      if (!isV2(args)) return { stdout: legacyOutput };
      const answer = answers.shift()!();
      if (answer instanceof Error) throw answer;
      return answer;
    });
    const note = vi.fn();
    expect(await measure(run, { note })).toBeNull();
    expect(await measure(run, { note })).toEqual(expected);
    expect(await measure(run, { note })).toBeNull();
    expect(switched(note)).toEqual([]);
    // That period has waited long enough: the next reads the Process counters.
    expect(await measure(run, { note })).toBeNull();
    expect(switched(note)).toEqual([expect.stringContaining(`typeperf timed out reading them ${V2_TIMEOUT_LIMIT} times in a row`)]);
    expect(await measure(run, { note })).toEqual(expectedLegacy);
    expect(await measure(run, { note })).toEqual(expectedLegacy);
    expect(read(run)).toEqual([...Array(4).fill('Process V2'), 'Process', 'Process']);
    expect(switched(note)).toHaveLength(1);
  });

  it("asks for Process V2 again after a try that didn't finish, and keeps it after a sample that failed", async () => {
    const run = vi.fn<NonNullable<MeasureOptions['run']>>()
      .mockRejectedValueOnce(Object.assign(new Error('Command timed out after 30000 milliseconds: typeperf.exe'), { timedOut: true }))
      .mockRejectedValueOnce(new Error("The agent host isn't running, so typeperf.exe didn't start"))
      .mockResolvedValueOnce({ stdout: v2Output })
      .mockResolvedValueOnce({ stdout: 'Error: No valid counters.' });
    expect(await measure(run)).toBeNull();
    expect(await measure(run)).toBeNull();
    expect(await measure(run)).toEqual(expected);
    // It read them before: this sample failed, not the counterset.
    expect(await measure(run)).toBeNull();
    expect(run.mock.calls.map(([, args]) => args[0])).toEqual(Array(4).fill('\\Process V2(*)\\Process ID'));
  });

  it('looks for the dev server when asked, from Process V2 only', async () => {
    const dev = [row('node#3', 300, 200, 100, 3000), ...busy.map((r) => (r[0] === 'Grove Bench' ? row('electron', 800, 300, 210, 2000) : r))]
      .map((r): Row => (r[0].startsWith('Grove Bench#') ? [`electron#${r[0].slice(-1)}`, ...r.slice(1)] as Row : r));
    const devMode = { main: { pid: 800, exe: 'electron.exe' }, devServer: true };
    const memory = await measure(async () => ({ stdout: typeperfOutput(toV2(dev), { set: PROCESS_V2 }) }), devMode);
    expect(memory && 'devServer' in memory ? memory.devServer : undefined).toEqual([{ name: 'node.exe', count: 1, bytes: 100 * MB }]);
    // On Windows 10, the Process counterset's node#3 above the app could be any node.exe.
    resetForTests();
    expect(await measure(windowsWith(typeperfOutput(dev)), devMode)).toMatchObject({ counters: 'Process', devServer: null });
  });

  it('runs nothing on other platforms', async () => {
    expect(await measure(windows11, { platform: 'linux' })).toBeNull();
    expect(windows11).not.toHaveBeenCalled();
  });

  it('is null when typeperf fails or prints no sample, noting only the first time', async () => {
    const note = vi.fn();
    const failing = vi.fn(async () => { throw new Error("The agent host isn't running, so typeperf.exe didn't start"); });
    expect(await measure(failing, { note })).toBeNull();
    expect(await measure(windows10, { note: () => {} })).toEqual(expectedLegacy);
    expect(await measure(async () => { throw turnedDown(); }, { note })).toBeNull();
    expect(note).toHaveBeenCalledOnce();
    expect(note.mock.calls[0][0]).toContain("The agent host isn't running");
  });

  describe("skips a sample that doesn't hold together, saying so once", () => {
    // The Process counterset's samples from 23 Oct: about half the busy
    // health lines put the wrong processes under the agents.
    const legacy = (values: (fields: string[]) => string[]) => windowsWith(typeperfOutput(busy, { values }));

    it('one whose values are off from the header after a process that exited', async () => {
      // "agents 17, 3.9 GB: conhost.exe 17 (2.7 GB), keyboxd.exe 1 (540 MB),
      // claude.exe 5 (333 MB), firefox.exe 3 (135 MB)": as read, without the
      // checks, the agents are other executables, and other processes'
      // memory is theirs.
      const values = shiftedAfter(busy, 'keyboxd');
      const table = tableOf(typeperfOutput(busy, { values }));
      const garbled = agentProcesses(table, busyRoots, { hostPid: 900, commands: new Set([TYPEPERF_PID]) });
      const bytesOf = (name: string) => garbled.byExe.find((e) => e.name === name)?.bytes ?? 0;
      expect(bytesOf('conhost.exe')).toBeGreaterThan(300 * MB); // 32 MB
      expect(bytesOf('claude.exe')).toBeLessThan(300 * MB); // 1.7 GB
      // The agents alone give it away, without the app and its host.
      expect(inconsistency(table, { roots: busyRoots })).toBe("thread aaaa1111's agent (pid 2210) is listed as grove bench.exe, not claude.exe");

      const note = vi.fn();
      expect(await measure(legacy(values), { note })).toBe(SKIPPED);
      expect(note).toHaveBeenCalledTimes(2);
      expect(note.mock.calls[1][0]).toMatch(/^\[process-memory\] typeperf's process list didn't hold together \(.+\), so the health line skipped the agents' memory/);
    });

    it("one whose agents are named after their console hosts, and theirs after the agents", async () => {
      // "agents 16 + 3 not a thread's, 5.2 GB: conhost.exe 19 (4.6 GB),
      // chrome.exe 1 (380 MB), ...": the agents' memory as conhost.exe's.
      const values = (v: string[]) => ['claude', 'claude#1', 'claude#2', 'claude#3'].reduce(
        (out, agent, i) => swapped(busy, agent, `conhost#${i + 1}`, ['ppid', 'bytes', 'ageSec', 'pid'])(out), v);
      const table = tableOf(typeperfOutput(busy, { values }));
      expect(agentProcesses(table, busyRoots, { hostPid: 900, commands: new Set([TYPEPERF_PID]) }).byExe[0]).toMatchObject({ name: 'conhost.exe', count: 4, bytes: 1750 * MB });
      expect(inconsistency(table, { roots: busyRoots })).toBe("thread aaaa1111's agent (pid 2210) is listed as conhost.exe, not claude.exe");
      expect(await measure(legacy(values))).toBe(SKIPPED);
    });

    it("one that puts other processes under the agents", async () => {
      // "agents 16 + 13 not a thread's, 3.8 GB: conhost.exe 16 (1.1 GB),
      // cmd.exe 9 (968 MB), node.exe 6 (637 MB), mousocoreworker.exe 1
      // (591 MB), claude.exe 3 (305 MB)": chrome under an agent, and its
      // memory a console host's.
      const values = (v: string[]) => swapped(busy, 'conhost#2', 'conhost', ['bytes'])(
        swapped(busy, 'chrome#1', 'conhost#1', ['ppid', 'ageSec'])(swapped(busy, 'claude#1', 'chrome', ['pid'])(v)));
      const table = tableOf(typeperfOutput(busy, { values }));
      expect(agentProcesses(table, busyRoots, { hostPid: 900, commands: new Set([TYPEPERF_PID]) }).byExe.map((e) => e.name)).toContain('chrome.exe');
      expect(inconsistency(table, { roots: busyRoots })).toBe("thread bbbb2222's agent (pid 3300) is listed as chrome.exe, not claude.exe");
      expect(await measure(legacy(values))).toBe(SKIPPED);
    });

    it('one that lists a value too few, and a Process V2 one whose names and IDs differ', async () => {
      expect(await measure(legacy((v) => v.slice(0, -1)))).toBe(SKIPPED);
      resetForTests();
      const mixed = v2Rows.map((r): Row => (r[0] === 'conhost:2211' ? ['conhost:3301', ...r.slice(1)] as Row : r[0] === 'conhost:3301' ? ['conhost:2211', ...r.slice(1)] as Row : r));
      expect(await measure(async () => ({ stdout: typeperfOutput(mixed, { set: PROCESS_V2 }) }))).toBe(SKIPPED);
    });

    it('noting only the first, and still measuring good ones', async () => {
      const note = vi.fn();
      const garbled = legacy(shiftedAfter(busy, 'keyboxd'));
      expect(await measure(garbled, { note })).toBe(SKIPPED);
      expect(await measure(garbled, { note })).toBe(SKIPPED);
      expect(await measure(windows10, { note })).toEqual(expectedLegacy);
      expect(note.mock.calls.filter(([line]) => line.includes("didn't hold together"))).toHaveLength(1);
    });
  });

  describe('from the Process counters, gives only what the checks vouch for', () => {
    // A mix-up among processes the app doesn't know passes the checks: here
    // a 4 GB node.exe of the PC's own (an editor's), whose memory the
    // Process counterset prints under an agent's MCP server's node#1, and
    // the other way round; and a console host's under another's.
    const rows = [...busy, row('node#3', 8000, 6000, 4000, 30_000)];
    const values = (v: string[]) => swapped(rows, 'conhost#2', 'conhost', ['bytes'])(swapped(rows, 'node#1', 'node#3', ['bytes'])(v));
    const mixedUp = typeperfOutput(rows, { values });

    it('a sample that mixes up processes under the agents passes the checks, and would put the wrong ones there', () => {
      const table = tableOf(mixedUp);
      expect(inconsistency(table, anchors)).toBeUndefined();
      const wrong = agentProcesses(table, busyRoots, { hostPid: 900, commands: new Set([TYPEPERF_PID]) });
      expect(wrong.largest[0]).toEqual({ name: 'node.exe', pid: 2320, bytes: 4000 * MB, thread: 'aaaa1111', under: ['claude.exe', 'cmd.exe', 'node.exe'] });
    });

    it('so it gives the agents and their own memory, no breakdown and no largest processes', async () => {
      const memory = await measure(windowsWith(mixedUp));
      expect(memory).toEqual(expectedLegacy);
      expect(memory).not.toHaveProperty('agents.byExe');
      expect(memory).not.toHaveProperty('agents.largest');
    });

    it('while Process V2 lists the same processes as they are', async () => {
      // Its instances are one process each: nothing to mix up.
      expect(await measure(async () => ({ stdout: typeperfOutput(toV2(rows), { set: PROCESS_V2 }) }))).toEqual(expected);
    });
  });

  describe('where typeperf runs, when not told', () => {
    const typeperfPath = expect.stringMatching(/\\System32\\typeperf\.exe$/i);
    const measureInHosts = (agentHostPid?: number) => measureProcesses({
      agents: () => busyRoots, agentHostPid: () => agentHostPid, main, recordCommandPids: () => () => new Set([TYPEPERF_PID]), platform: 'win32', note: () => {},
    });

    beforeEach(() => {
      hosts.agentHostGaveUp.mockReset().mockReturnValue(false);
      hosts.runInAgentHost.mockReset().mockResolvedValue({ stdout: v2Output });
      hosts.runProcessInHost.mockReset().mockResolvedValue({ stdout: v2Output });
    });

    it('in the agent host, host-only, so never in the main process', async () => {
      expect(await measureInHosts(900)).toEqual(expected);
      expect(hosts.runInAgentHost).toHaveBeenCalledExactlyOnceWith(typeperfPath, typeperfArgs(PROCESS_V2), { timeout: TYPEPERF_TIMEOUT_MS, hostOnly: true });
      expect(hosts.runProcessInHost).not.toHaveBeenCalled();
    });

    it('in the git host, host-only too, once the agent host has given up for good', async () => {
      hosts.agentHostGaveUp.mockReturnValue(true);
      // The agents run in the main process now; the agent host has no pid.
      expect(await measureInHosts(undefined)).toMatchObject({ counters: 'Process V2', agents: { agents: 5, untracked: 0 } });
      expect(hosts.runProcessInHost).toHaveBeenCalledExactlyOnceWith(typeperfPath, typeperfArgs(PROCESS_V2), { timeout: TYPEPERF_TIMEOUT_MS });
      expect(hosts.runInAgentHost).not.toHaveBeenCalled();
    });
  });
});
