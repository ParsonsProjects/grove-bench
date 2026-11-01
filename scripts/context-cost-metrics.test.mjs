import { describe, it, expect } from 'vitest';
import {
  commandHead, safeTrimmedLength, priceFor, claudeToolKind, readClaudeTranscript, readGroveLog, analyseChain,
  measureCharsPerToken, mergeAnalysis, emptyAnalysis, renderReport, median, percentile,
  STARTING, AGENT_OUTPUT, YOUR_MESSAGES, OTHER, SUMMARY,
} from './context-cost-metrics.mjs';

const ESC = String.fromCharCode(27);

describe('commandHead', () => {
  it('keeps the program and its subcommand, without paths or arguments', () => {
    expect(commandHead('git diff --stat src/main')).toBe('git diff');
    expect(commandHead('npm run test -- --watch')).toBe('npm run');
    expect(commandHead('C:\\tools\\rg.exe -n foo src')).toBe('rg');
    expect(commandHead('./node_modules/.bin/vitest run')).toBe('vitest run');
    expect(commandHead('python -m pytest')).toBe('python');
  });

  it('skips a leading cd and variable assignments, which would show a path', () => {
    expect(commandHead('cd /home/me/secret && npm test')).toBe('npm test');
    expect(commandHead('F=/home/me/notes.jsonl; wc -l $F')).toBe('wc');
    expect(commandHead('$p = "C:\\x"; Get-ChildItem $p')).toBe('get-childitem');
    expect(commandHead('NODE_ENV=test node build.mjs')).toBe('node');
  });

  it('names loops instead of their variable, and gives nothing for no command', () => {
    expect(commandHead('for f in *.ts; do wc -l $f; done')).toBe('(shell loop or condition)');
    expect(commandHead('cd x')).toBeUndefined();
    expect(commandHead(undefined)).toBeUndefined();
  });
});

describe('safeTrimmedLength', () => {
  it('drops colour codes, overwritten progress, trailing spaces and CRLF endings', () => {
    expect(safeTrimmedLength(`${ESC}[32mok${ESC}[0m`)).toBe(2);
    expect(safeTrimmedLength('10%\r50%\r100%')).toBe(4);
    expect(safeTrimmedLength('a  \r\nb\r\n')).toBe('a\nb\n'.length);
  });

  it('keeps a line repeated 3 or more times once, with a count, and blank runs as one', () => {
    expect(safeTrimmedLength('x\nx\n')).toBe(4);
    const repeated = 'warn: deprecated\n'.repeat(5);
    expect(safeTrimmedLength(repeated)).toBe('warn: deprecated\n[same line 4 more times]\n'.length);
    expect(safeTrimmedLength('a\n\n\n\nb')).toBe('a\n\nb'.length);
  });
});

describe('priceFor', () => {
  it('reads the longest matching prefix, so Opus 5.5 is not Opus 5', () => {
    expect(priceFor('claude-opus-5-5')).toEqual({ input: 4, output: 20, cacheRead: 0.2 });
    expect(priceFor('claude-opus-5')).toEqual({ input: 5, output: 25, cacheRead: 0.5 });
    expect(priceFor('claude-opus-5-5[1m]')?.input).toBe(4);
    expect(priceFor('anthropic.claude-sonnet-5-5')?.input).toBe(2);
  });

  it('has no price for other providers or a missing model', () => {
    expect(priceFor('openrouter/deepseek/deepseek-v4.1-flash')).toBeNull();
    expect(priceFor(undefined)).toBeNull();
  });
});

describe('claudeToolKind', () => {
  it('maps Claude Code tools to the kinds Grove uses for every agent', () => {
    expect(claudeToolKind('Bash')).toBe('shell');
    expect(claudeToolKind('Grep')).toBe('search');
    expect(claudeToolKind('mcp__grove__memory_read')).toBe('mcp');
    expect(claudeToolKind('TodoWrite')).toBe('other');
  });
});

const usage = (u) => ({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, ...u });

describe('readClaudeTranscript', () => {
  const entries = [
    { type: 'ai-title', aiTitle: 'Fix the build' },
    { type: 'user', message: { content: 'Fix it' } },
    // One call written as two entries, one per content block.
    { type: 'assistant', requestId: 'r1', message: { id: 'm1', model: 'claude-opus-5-5', usage: usage({ cache_creation_input_tokens: 1000, cache_creation: { ephemeral_1h_input_tokens: 400 }, output_tokens: 30 }), content: [{ type: 'thinking' }] } },
    { type: 'assistant', requestId: 'r1', message: { id: 'm1', model: 'claude-opus-5-5', usage: usage({ cache_creation_input_tokens: 1000, cache_creation: { ephemeral_1h_input_tokens: 400 }, output_tokens: 30 }), content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'cd /x && npm test' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'FAIL 1 test' }] }] } },
    { type: 'user', isMeta: true, message: { content: '<system-reminder>note</system-reminder>' } },
    { type: 'assistant', requestId: 'r2', message: { id: 'm2', model: '<synthetic>', usage: usage({}), content: [] } },
    { type: 'assistant', requestId: 'r3', message: { id: 'm3', model: 'claude-opus-5-5', usage: usage({ cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 }), content: [] } },
    { type: 'system', subtype: 'compact_boundary' },
    { type: 'user', isCompactSummary: true, message: { content: 'Summary of what happened' } },
    { type: 'assistant', requestId: 'r4', message: { id: 'm4', model: 'claude-opus-5-5', usage: usage({ cache_creation_input_tokens: 300 }), content: [] } },
    // A subagent written into the same file by an older version.
    { type: 'user', isSidechain: true, message: { content: 'Look around' } },
    { type: 'assistant', isSidechain: true, requestId: 's1', message: { id: 's1', model: 'claude-haiku-5-5', usage: usage({ cache_creation_input_tokens: 200 }), content: [] } },
  ];
  const { chains, title } = readClaudeTranscript(entries);

  it('reads one call per request, skips failed ones, and keeps the title', () => {
    expect(title).toBe('Fix the build');
    expect(chains).toHaveLength(2);
    expect(chains[0].filter((s) => s.kind === 'call')).toHaveLength(3);
    expect(chains[0][0]).toEqual({ kind: 'call', items: [{ label: YOUR_MESSAGES, chars: 6, trimmedChars: 6 }], call: { uncached: 0, write5m: 600, write1h: 400, read: 0, output: 30, model: 'claude-opus-5-5' } });
  });

  it('names each tool result after its call, with the command it ran, and tells reminders apart', () => {
    expect(chains[0][1].items).toEqual([
      { label: 'Tool: Bash', kind: 'shell', chars: 11, trimmedChars: 11, command: 'npm test' },
      { label: OTHER, chars: 39, trimmedChars: 39 },
    ]);
  });

  it('marks a compaction once, and starts the next context with its summary', () => {
    expect(chains[0][2]).toEqual({ kind: 'compact' });
    expect(chains[0][3].items).toEqual([{ label: SUMMARY, chars: 24, trimmedChars: 24 }]);
  });

  it('gives a subagent written into the file its own chain', () => {
    expect(chains[1]).toHaveLength(1);
    expect(chains[1][0].call.model).toBe('claude-haiku-5-5');
  });
});

describe('readGroveLog', () => {
  it('reads one call per Claude Code message, though it is reported per content block', () => {
    const steps = readGroveLog([
      { type: 'system_init', model: 'claude-sonnet-5-5', sessionId: 's', tools: [] },
      { type: 'user_message', text: 'Hi there' },
      { type: 'assistant_tool_use', toolName: 'Bash', toolInput: { command: 'git status' }, toolUseId: 't1', toolView: { kind: 'shell', command: 'git status' } },
      { type: 'usage', inputTokens: 5, outputTokens: 10, cacheReadTokens: 100, cacheCreationTokens: 20 },
      { type: 'usage', inputTokens: 5, outputTokens: 12, cacheReadTokens: 100, cacheCreationTokens: 20 },
      { type: 'tool_result', toolUseId: 't1', content: 'clean' },
      { type: 'tool_result', toolUseId: 'sub', content: 'from a subagent', parentToolUseId: 'p' },
      { type: 'usage', inputTokens: 5, outputTokens: 3, cacheReadTokens: 125, cacheCreationTokens: 10 },
    ], { model: 'opus' });
    expect(steps).toEqual([
      { kind: 'call', items: [{ label: YOUR_MESSAGES, chars: 8, trimmedChars: 8 }], call: { uncached: 5, write5m: 20, write1h: 0, read: 100, output: 12, model: 'claude-sonnet-5-5' } },
      { kind: 'call', items: [{ label: 'Tool: Bash', kind: 'shell', chars: 5, trimmedChars: 5, command: 'git status' }], call: { uncached: 5, write5m: 10, write1h: 0, read: 125, output: 3, model: 'claude-sonnet-5-5' } },
    ]);
  });

  it('reads an ACP agent\'s context reports as calls with a total only, kinded by its ToolView', () => {
    const steps = readGroveLog([
      { type: 'assistant_tool_use', toolName: 'execute', toolInput: {}, toolUseId: 'a' },
      { type: 'tool_update', toolUseId: 'a', toolView: { kind: 'shell', command: 'pytest -q' } },
      { type: 'tool_result', toolUseId: 'a', content: 'passed' },
      { type: 'usage', inputTokens: 9000, outputTokens: 0 },
      { type: 'usage', inputTokens: 9000, outputTokens: 400 },
    ], { model: 'openrouter/deepseek/deepseek-v4.1-flash' });
    expect(steps).toEqual([
      { kind: 'call', items: [{ label: 'Tool: execute', kind: 'shell', chars: 6, trimmedChars: 6, command: 'pytest' }], call: { total: 9000, output: 400, model: 'openrouter/deepseek/deepseek-v4.1-flash' } },
    ]);
  });
});

describe('analyseChain', () => {
  // Worked by hand at Opus 5.5 prices: input $4, 5-minute write $5, read $0.20, output $20 a million.
  const steps = [
    { kind: 'call', items: [{ label: YOUR_MESSAGES, chars: 350 }], call: { uncached: 0, write5m: 1000, write1h: 0, read: 0, output: 50, model: 'claude-opus-5-5' } },
    { kind: 'call', items: [{ label: 'Tool: Bash', kind: 'shell', chars: 700, trimmedChars: 500, command: 'npm test' }], call: { uncached: 0, write5m: 250, write1h: 0, read: 1000, output: 10, model: 'claude-opus-5-5' } },
  ];
  const { parts, totals } = analyseChain(steps, { charsPerToken: 3.5 });

  it('bills the cached front at the read price and the new end at the write price', () => {
    // Call 1: 1,000 tokens written ($0.005): 100 are the message, 900 the starting context.
    // Call 2: the first 1,000 read ($0.0002), then the output (50) and Bash (200) written ($0.00125).
    expect(parts.get(STARTING).cost).toBeCloseTo(900 * 5e-6 + 900 * 0.2e-6, 10);
    expect(parts.get(YOUR_MESSAGES).cost).toBeCloseTo(100 * 5e-6 + 100 * 0.2e-6, 10);
    expect(parts.get(AGENT_OUTPUT).cost).toBeCloseTo(50 * 5e-6, 10);
    expect(parts.get('Tool: Bash').cost).toBeCloseTo(200 * 5e-6, 10);
    expect(totals.inputCost).toBeCloseTo(0.005 + 0.00145, 10);
    expect(totals.outputCost).toBeCloseTo(60 * 20e-6, 10);
  });

  it('adds the parts up to the input bill, and keeps sizes and commands', () => {
    const sum = [...parts.values()].reduce((n, p) => n + p.cost, 0);
    expect(sum).toBeCloseTo(totals.inputCost, 12);
    const bash = parts.get('Tool: Bash');
    expect(bash).toMatchObject({ items: 1, chars: 700, trimmedChars: 500, added: 200, tokenCalls: 200, sizes: [700] });
    expect(bash.commands.get('npm test')).toMatchObject({ runs: 1, chars: 700, tokenCalls: 200 });
    expect(bash.commands.get('npm test').cost).toBeCloseTo(200 * 5e-6, 10);
  });

  it('scales every part down when the context is smaller than they add up to', () => {
    const { parts: p } = analyseChain([...steps, { kind: 'call', items: [], call: { uncached: 0, write5m: 0, write1h: 0, read: 1100, output: 0, model: 'claude-opus-5-5' } }], { charsPerToken: 3.5 });
    const read = [...p.values()].reduce((n, x) => n + x.tokenCalls, 0);
    expect(read).toBeCloseTo(1000 + 1250 + 1100, 6);
    expect(p.get(OTHER)).toBeUndefined();
  });

  it('starts over after a compaction, with the next call\'s extra as starting context', () => {
    const { parts: p } = analyseChain([...steps, { kind: 'compact' }, { kind: 'call', items: [{ label: SUMMARY, chars: 70 }], call: { uncached: 0, write5m: 400, write1h: 0, read: 0, output: 0, model: 'claude-opus-5-5' } }], { charsPerToken: 3.5 });
    expect(p.get(SUMMARY).added).toBeCloseTo(20, 10);
    expect(p.get(STARTING).added).toBeCloseTo(900 + 380, 10);
  });

  it('counts the context of an agent that reports only totals, with no cost', () => {
    const { parts: p, totals: t } = analyseChain([{ kind: 'call', items: [{ label: 'Tool: execute', kind: 'shell', chars: 35 }], call: { total: 500, output: 20, model: 'openrouter/x' } }], { charsPerToken: 3.5 });
    expect(p.get('Tool: execute').tokenCalls).toBeCloseTo(10, 10);
    expect(p.get(STARTING).tokenCalls).toBeCloseTo(490, 10);
    expect(t).toMatchObject({ calls: 1, contextOnlyCalls: 1, unpricedCalls: 1, inputCost: 0, outputCost: 0 });
  });
});

describe('measureCharsPerToken', () => {
  const call = (read, write, output) => ({ uncached: 0, write5m: write, write1h: 0, read, output });
  it('takes the median over calls that added only tool results, and none with too few', () => {
    const steps = [{ kind: 'call', items: [], call: call(0, 1000, 100) }];
    let size = 1000;
    // Each call adds 100 output tokens and 1,000 tokens of results: 3,000 characters, so 3 a token.
    for (let i = 0; i < 12; i++) {
      steps.push({ kind: 'call', items: [{ label: 'Tool: Read', chars: 3000 }], call: call(size, 1100, 100) });
      size += 1100;
    }
    expect(measureCharsPerToken([steps])).toEqual({ value: 3, samples: 12 });
    expect(measureCharsPerToken([steps.slice(0, 5)])).toEqual({ value: null, samples: 4 });
  });
});

describe('median and percentile', () => {
  it('handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });
});

describe('renderReport', () => {
  it('reports the totals, tools and commands, without command arguments', () => {
    const steps = [
      { kind: 'call', items: [{ label: YOUR_MESSAGES, chars: 35 }], call: { uncached: 0, write5m: 1000, write1h: 0, read: 0, output: 50, model: 'claude-opus-5-5' } },
      { kind: 'call', items: [{ label: 'Tool: Bash', kind: 'shell', chars: 700, trimmedChars: 700, command: commandHead('cd /home/me/private && npm test -- secret-name') }], call: { uncached: 0, write5m: 250, write1h: 0, read: 1000, output: 10, model: 'claude-opus-5-5' } },
    ];
    const analysis = mergeAnalysis(emptyAnalysis(), analyseChain(steps, { charsPerToken: 3.5 }));
    const md = renderReport({ all: analysis, threads: [{ title: 'Fix it', agent: 'claude-code', source: 'Grove log', analysis }], charsPerToken: { value: null, samples: 0, used: 3.5 }, generated: '2026-11-01', sources: ['Grove thread logs'] });
    expect(md).toContain('# Context cost report');
    expect(md).toContain('1 thread, 2 model calls');
    expect(md).toContain('| npm test | 1 |');
    expect(md).toContain('assumed, as only 0 calls could measure it');
    expect(md).not.toMatch(/private|secret-name/);
  });
});
