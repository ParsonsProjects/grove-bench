import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import { transformMessage, isPathInside, ClaudeCodeAdapter, supportsLargeContext, CONTEXT_1M_BETA, THINKING_LEVEL_TOKENS, thinkingConfigFor, parseMcpListOutput, mcpServerManager, claudeMcpOrigin, mcpToolServerKey, mcpContextCostByServer, toMcpElicitationRequest, withMcpjsonApproval, mcpjsonApprovalsFrom, buildMcpAddArgs, quoteArg, validatePluginId, validateConfigScope, capToolResult, claudeControlsFor, supportsAdaptiveThinking, supportsFastMode, supportsAutoMode, claudeModelCaps, effortFor, reasoningOptionsFor, toSdkPermissionMode, fromSdkSyncMode, stripAnsi, mapClaudeUsage } from './claude-code.js';
import type { AgentEvent } from '../../shared/types.js';

// ─── isPathInside (sandbox allowWrite containment) ───

describe('isPathInside()', () => {
  const root = path.resolve('/repo/src');

  it('accepts a nested child path', () => {
    expect(isPathInside(root, path.join(root, 'a', 'b.ts'))).toBe(true);
  });

  it('accepts the directory itself', () => {
    expect(isPathInside(root, root)).toBe(true);
  });

  it('rejects a sibling that shares a name prefix (the startsWith bug)', () => {
    expect(isPathInside(root, path.resolve('/repo/src-secret/x.ts'))).toBe(false);
  });

  it('rejects a sibling directory', () => {
    expect(isPathInside(root, path.resolve('/repo/other.ts'))).toBe(false);
  });

  it('rejects parent-directory traversal', () => {
    expect(isPathInside(root, path.join(root, '..', '..', 'etc', 'passwd'))).toBe(false);
  });
});

// ─── getModels ───

describe('getModels()', () => {
  const models = new ClaudeCodeAdapter().getModels();

  it('lists Opus 5.5 first (used as the default model)', () => {
    expect(models[0]).toMatchObject({ id: 'claude-opus-5-5', label: 'Opus 5.5' });
  });

  it('offers Fable 5 but not as the default', () => {
    const fable = models.find((m) => m.id === 'claude-fable-5');
    expect(fable).toMatchObject({ label: 'Fable 5', contextWindow: 1_000_000 });
    expect(models[0].id).not.toBe('claude-fable-5');
  });

  it('reports 1M context for Opus/Sonnet models and 200k for Haiku', () => {
    for (const m of models) {
      const expected = m.id.startsWith('claude-haiku') ? 200_000 : 1_000_000;
      expect(m.contextWindow, m.id).toBe(expected);
    }
  });
});

// ─── Session controls ───

describe('getControls()', () => {
  const adapter = new ClaudeCodeAdapter();
  const ids = (model: string | null) => adapter.getControls(model).map((d) => d.id);

  it('declares mode, effort, thinking, and speed for an unset model', () => {
    expect(ids(null)).toEqual(['permissionMode', 'effort', 'thinking', 'speed']);
    expect(adapter.getControls(null)).toEqual(claudeControlsFor(null));
  });

  it('offers every Grove permission mode in the status-bar order', () => {
    const mode = adapter.getControls('claude-opus-5').find((d) => d.id === 'permissionMode')!;
    expect(mode.options.map((o) => o.value)).toEqual(['default', 'plan', 'acceptEdits', 'auto', 'readSafe']);
    expect(mode.default).toBe('default');
    // Grove's own mode is grouped so the UI divides it from Claude's modes.
    expect(mode.options.map((o) => o.group)).toEqual([undefined, undefined, undefined, undefined, 'Grove Bench']);
  });

  it('drops native auto mode on models the provider does not support it on', () => {
    const haiku = adapter.getControls('claude-haiku-4-5-20251001').find((d) => d.id === 'permissionMode')!;
    expect(haiku.options.map((o) => o.value)).toEqual(['default', 'plan', 'acceptEdits', 'readSafe']);
    expect(haiku.options.at(-1)?.group).toBe('Grove Bench');
    expect(supportsAutoMode('claude-haiku-4-5-20251001')).toBe(false);
    expect(supportsAutoMode('claude-sonnet-4-6')).toBe(true);
    expect(supportsAutoMode(null)).toBe(true);
  });

  it('offers Thinking as On/Off on adaptive models and fixed budgets only on Haiku', () => {
    const opus = adapter.getControls('claude-opus-5').find((d) => d.id === 'thinking')!;
    expect(opus.options.map((o) => o.value)).toEqual(['off', 'adaptive']);
    expect(opus.default).toBe('adaptive');

    const haiku = adapter.getControls('claude-haiku-4-5-20251001').find((d) => d.id === 'thinking')!;
    expect(haiku.options.map((o) => o.value)).toEqual(['off', 'low', 'medium', 'high']);
    expect(haiku.default).toBe('high');
    expect(supportsAdaptiveThinking('claude-haiku-4-5-20251001')).toBe(false);
    expect(supportsAdaptiveThinking('claude-sonnet-4-6')).toBe(true);
  });

  it('has no Thinking control on models that reject disabled thinking', () => {
    for (const model of ['claude-opus-5-5', 'claude-fable-5']) {
      expect(ids(model), model).not.toContain('thinking');
      expect(claudeModelCaps(model).thinkingOff, model).toBe(false);
    }
  });

  it('offers effort levels per model with the model default', () => {
    const effort = (model: string) => adapter.getControls(model).find((d) => d.id === 'effort');
    expect(effort('claude-opus-5-5')).toMatchObject({ default: 'medium' });
    expect(effort('claude-opus-5-5')!.options.map((o) => o.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effort('claude-opus-5')).toMatchObject({ default: 'high' });
    expect(effort('claude-opus-4-7')).toMatchObject({ default: 'xhigh' });
    expect(effort('claude-opus-4-6')!.options.map((o) => o.value)).toEqual(['low', 'medium', 'high', 'max']);
    expect(effort('claude-sonnet-4-6')!.options.map((o) => o.value)).not.toContain('xhigh');
    expect(effort('claude-haiku-4-5-20251001')).toBeUndefined();
  });

  it('matches dated ids by longest prefix so Opus 5.5 never reads as Opus 5', () => {
    expect(claudeModelCaps('claude-opus-5-5-20260901')).toBe(claudeModelCaps('claude-opus-5-5'));
    expect(claudeModelCaps('claude-opus-5-20260801')).toBe(claudeModelCaps('claude-opus-5'));
    expect(claudeModelCaps('claude-haiku-4-5-20251001')).toBe(claudeModelCaps('claude-haiku-4-5'));
  });

  it('builds query-start thinking and effort from recorded controls', () => {
    expect(reasoningOptionsFor('claude-opus-5', { thinking: 'off', effort: 'low' }))
      .toEqual({ thinking: { type: 'disabled' }, effort: 'low' });
    // Opus 5.5 can't turn thinking off: a carried-over 'off' is not sent.
    expect(reasoningOptionsFor('claude-opus-5-5', { thinking: 'off', effort: 'medium' }))
      .toEqual({ thinking: null, effort: 'medium' });
    expect(reasoningOptionsFor('claude-haiku-4-5-20251001', { thinking: 'low', effort: 'high' }))
      .toEqual({ thinking: { type: 'enabled', budgetTokens: THINKING_LEVEL_TOKENS.low }, effort: undefined });
    expect(reasoningOptionsFor('claude-opus-5', undefined)).toEqual({ thinking: null, effort: undefined });
  });

  it('only sends effort levels the model accepts', () => {
    expect(effortFor('claude-opus-5-5', 'max')).toBe('max');
    expect(effortFor('claude-opus-4-6', 'xhigh')).toBeUndefined();
    expect(effortFor('claude-haiku-4-5-20251001', 'high')).toBeUndefined();
    expect(effortFor('claude-opus-5', undefined)).toBeUndefined();
  });

  it('offers fast mode only where the provider supports it', () => {
    expect(ids('claude-opus-5-5')).toContain('speed');
    expect(ids('claude-opus-5')).toContain('speed');
    expect(ids('claude-opus-4-8')).toContain('speed');
    expect(ids('claude-opus-4-6')).not.toContain('speed');
    expect(ids('claude-sonnet-4-6')).not.toContain('speed');
    expect(ids('claude-haiku-4-5-20251001')).not.toContain('speed');
    expect(supportsFastMode('claude-fable-5')).toBe(false);
  });

  it('gives every option a badge label and a tone, and every default is a real option', () => {
    for (const model of [null, ...adapter.getModels().map((m) => m.id)]) {
      for (const d of adapter.getControls(model)) {
        expect(d.options.length, `${model}/${d.id}`).toBeGreaterThan(1);
        expect(d.options.map((o) => o.value), `${model}/${d.id}`).toContain(d.default);
        for (const o of d.options) {
          expect(o.label, `${model}/${d.id}/${o.value}`).toBeTruthy();
          expect(o.tone, `${model}/${d.id}/${o.value}`).toBeTruthy();
        }
      }
    }
  });
});

// ─── Plan usage mapping ───

describe('mapClaudeUsage()', () => {
  const NOW = 1_800_000_000_000;

  it('reports unavailable (with the plan) when the SDK has no plan limits', () => {
    expect(mapClaudeUsage({ subscription_type: null, rate_limits_available: false, rate_limits: null }, NOW))
      .toEqual({ available: false, plan: null, windows: [], fetchedAt: NOW });
    expect(mapClaudeUsage(null, NOW).available).toBe(false);
  });

  it('maps percent utilization to a fraction and ISO resets to epoch seconds', () => {
    const usage = mapClaudeUsage({
      subscription_type: 'max',
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 42, resets_at: '2027-01-01T10:00:00Z' },
        seven_day: { utilization: 18, resets_at: null },
      },
    }, NOW);

    expect(usage).toMatchObject({ available: true, plan: 'max', fetchedAt: NOW });
    expect(usage.windows).toEqual([
      { id: 'five_hour', label: '5-hour', utilization: 0.42, resetsAt: Math.round(Date.parse('2027-01-01T10:00:00Z') / 1000) },
      { id: 'seven_day', label: 'Weekly', utilization: 0.18 },
    ]);
  });

  it('drops windows without a utilization, clamps to 0–1, and includes per-model and enabled extra usage', () => {
    const usage = mapClaudeUsage({
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: null, resets_at: '2027-01-01T10:00:00Z' },
        seven_day_opus: { utilization: 130, resets_at: 'not a date' },
        model_scoped: [{ display_name: 'Fable', utilization: 5, resets_at: null }],
        extra_usage: { is_enabled: true, utilization: 12, resets_at: null },
      },
    }, NOW);

    expect(usage.windows.map((w) => w.id)).toEqual(['seven_day_opus', 'model:Fable', 'extra_usage']);
    expect(usage.windows[0]).toEqual({ id: 'seven_day_opus', label: 'Weekly · Opus', utilization: 1 });
    expect(usage.windows[1].label).toBe('Weekly · Fable');
  });

  it('omits extra usage when it is not enabled', () => {
    const usage = mapClaudeUsage({
      rate_limits_available: true,
      rate_limits: { extra_usage: { is_enabled: false, utilization: 12, resets_at: null } },
    }, NOW);
    expect(usage.windows).toEqual([]);
  });
});

// ─── 1M context beta gating ───

describe('THINKING_LEVEL_TOKENS', () => {
  it('disables thinking at off', () => {
    expect(THINKING_LEVEL_TOKENS.off).toBe(0);
  });

  it('uses the provider default (no limit) at high and adaptive', () => {
    expect(THINKING_LEVEL_TOKENS.high).toBeNull();
    expect(THINKING_LEVEL_TOKENS.adaptive).toBeNull();
  });

  it('scales budgets monotonically between levels', () => {
    expect(THINKING_LEVEL_TOKENS.low).toBeGreaterThan(0);
    expect(THINKING_LEVEL_TOKENS.medium).toBeGreaterThan(THINKING_LEVEL_TOKENS.low!);
  });
});

describe('thinkingConfigFor()', () => {
  it('returns null for high and unset so the provider default applies', () => {
    expect(thinkingConfigFor('high')).toBeNull();
    expect(thinkingConfigFor(null)).toBeNull();
    expect(thinkingConfigFor(undefined)).toBeNull();
  });

  it('maps adaptive to the adaptive thinking config', () => {
    expect(thinkingConfigFor('adaptive')).toEqual({ type: 'adaptive' });
  });

  it('maps off to disabled', () => {
    expect(thinkingConfigFor('off')).toEqual({ type: 'disabled' });
  });

  it('maps low/medium to fixed budgets', () => {
    expect(thinkingConfigFor('low')).toEqual({ type: 'enabled', budgetTokens: THINKING_LEVEL_TOKENS.low });
    expect(thinkingConfigFor('medium')).toEqual({ type: 'enabled', budgetTokens: THINKING_LEVEL_TOKENS.medium });
  });
});

describe('parseMcpListOutput()', () => {
  it('parses connected http servers with transport annotations', () => {
    const out = 'Checking MCP server health…\n\nsentry: https://mcp.sentry.dev/mcp (HTTP) - ✔ Connected\n';
    expect(parseMcpListOutput(out)).toEqual([
      { name: 'sentry', target: 'https://mcp.sentry.dev/mcp', transport: 'HTTP', status: 'connected' },
    ]);
  });

  it('handles names containing colons and tags plugin servers', () => {
    const out = 'plugin:figma:figma: https://mcp.figma.com/mcp (HTTP) - ✔ Connected\n';
    expect(parseMcpListOutput(out)).toEqual([
      {
        name: 'plugin:figma:figma',
        target: 'https://mcp.figma.com/mcp',
        transport: 'HTTP',
        status: 'connected',
        managedBy: { label: 'figma plugin', hint: expect.stringMatching(/Plugins tab/) },
      },
    ]);
  });

  it('tags claude.ai connectors', () => {
    const out = 'claude.ai Gmail: https://mcp.example.com/gmail - ✔ Connected\n';
    expect(parseMcpListOutput(out)[0]).toMatchObject({ name: 'claude.ai Gmail', managedBy: { label: 'claude.ai' } });
  });

  it('maps auth, approval, and failure statuses', () => {
    // "Pending approval" is an unapproved .mcp.json server, not one still connecting
    const out = [
      'a: https://a.example/mcp - ! Needs authentication',
      'b: npx b-server - ⏸ Pending approval',
      'c: npx c-server - ✘ Failed to connect',
    ].join('\n');
    expect(parseMcpListOutput(out).map((s) => s.status)).toEqual(['needs-auth', 'needs-approval', 'failed']);
  });

  it('parses stdio servers without a transport annotation', () => {
    const out = 'my-server: npx -y my-mcp-server - ✔ Connected\n';
    expect(parseMcpListOutput(out)).toEqual([
      { name: 'my-server', target: 'npx -y my-mcp-server', status: 'connected' },
    ]);
  });

  it('skips banner and blank lines', () => {
    expect(parseMcpListOutput('Checking MCP server health…\n\n')).toEqual([]);
  });

  it('tells unapproved and rejected project servers apart from connection states', () => {
    const out = [
      'repo-tools: npx repo-tools - ⏸ Pending approval (run `claude` to approve)',
      'old-tools: npx old-tools - ✘ Rejected (see disabledMcpjsonServers in settings)',
      'off: npx off - ⊘ Disabled for this project (re-enable via /mcp)',
    ].join('\n');
    expect(parseMcpListOutput(out).map((s) => s.status)).toEqual(['needs-approval', 'rejected', 'disabled']);
  });
});

describe('mcpToolServerKey()', () => {
  it('matches the server part of mcp__<server>__<tool> names', () => {
    expect(mcpToolServerKey('my-server_1')).toBe('my-server_1');
    expect(mcpToolServerKey('plugin:figma:figma')).toBe('plugin_figma_figma');
    expect(mcpToolServerKey('claude.ai Google Drive')).toBe('claude_ai_Google_Drive');
  });
});

describe('mcpContextCostByServer()', () => {
  it('sums loaded and deferred tokens per server under its real name', () => {
    const tools = [
      { name: 'mcp__plugin_figma_figma__a', serverName: 'plugin_figma_figma', tokens: 100, isLoaded: true },
      { name: 'mcp__plugin_figma_figma__b', serverName: 'plugin_figma_figma', tokens: 50 },
      { name: 'mcp__plugin_figma_figma__c', serverName: 'plugin_figma_figma', tokens: 70, isLoaded: false },
      { name: 'mcp__gone__x', serverName: 'gone', tokens: 5 },
    ];
    expect(mcpContextCostByServer(tools, ['plugin:figma:figma'])).toEqual([
      { serverName: 'plugin:figma:figma', tokens: 150, deferredTokens: 70 },
      { serverName: 'gone', tokens: 5, deferredTokens: 0 },
    ]);
  });
});

describe('toMcpElicitationRequest()', () => {
  it('defaults the mode to form and keeps what the UI needs', () => {
    expect(toMcpElicitationRequest({ serverName: 's', message: 'm', requestedSchema: { type: 'object' } })).toEqual({
      serverName: 's', message: 'm', mode: 'form', requestedSchema: { type: 'object' },
    });
    expect(toMcpElicitationRequest({ serverName: 's', message: 'm', mode: 'url', url: 'https://x.example', elicitationId: 'e1' })).toEqual({
      serverName: 's', message: 'm', mode: 'url', url: 'https://x.example',
    });
  });
});

describe('.mcp.json approvals', () => {
  it('approves a server the way the CLI prompt does', () => {
    expect(withMcpjsonApproval({ other: 1, enabledMcpjsonServers: ['a'], disabledMcpjsonServers: ['b', 'c'] }, 'b')).toEqual({
      other: 1, enabledMcpjsonServers: ['a', 'b'], disabledMcpjsonServers: ['c'],
    });
    expect(withMcpjsonApproval({ disabledMcpjsonServers: ['b'] }, 'b')).toEqual({ enabledMcpjsonServers: ['b'] });
    expect(withMcpjsonApproval({ enabledMcpjsonServers: ['b'] }, 'b')).toEqual({ enabledMcpjsonServers: ['b'] });
  });

  it('picks only the approval keys', () => {
    expect(mcpjsonApprovalsFrom({ permissions: {}, enabledMcpjsonServers: ['a'], enableAllProjectMcpServers: false })).toEqual({
      enabledMcpjsonServers: ['a'], enableAllProjectMcpServers: false,
    });
  });

  it('writes approvals to the project and worktrees, and new worktrees inherit them', async () => {
    const fsp = await import('node:fs/promises');
    const os = await import('node:os');
    const nodePath = await import('node:path');
    const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'grove-mcp-'));
    const repo = nodePath.join(root, 'repo');
    const wt = nodePath.join(root, 'wt');
    await fsp.mkdir(nodePath.join(repo, '.claude'), { recursive: true });
    await fsp.writeFile(nodePath.join(repo, '.claude', 'settings.local.json'), JSON.stringify({ keep: true }));
    try {
      const adapter = new ClaudeCodeAdapter();
      await adapter.approveProjectMcpServer('repo-tools', [repo, wt]);
      const read = async (dir: string) => JSON.parse(await fsp.readFile(nodePath.join(dir, '.claude', 'settings.local.json'), 'utf8'));
      expect(await read(repo)).toEqual({ keep: true, enabledMcpjsonServers: ['repo-tools'] });
      expect(await read(wt)).toEqual({ enabledMcpjsonServers: ['repo-tools'] });

      const fresh = nodePath.join(root, 'fresh');
      await adapter.generateWorktreeSettings(fresh, repo);
      expect(await read(fresh)).toMatchObject({ permissions: expect.any(Object), enabledMcpjsonServers: ['repo-tools'] });
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("doesn't overwrite a settings file it can't parse", async () => {
    const fsp = await import('node:fs/promises');
    const os = await import('node:os');
    const nodePath = await import('node:path');
    const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'grove-mcp-'));
    const file = nodePath.join(root, '.claude', 'settings.local.json');
    await fsp.mkdir(nodePath.dirname(file), { recursive: true });
    await fsp.writeFile(file, '{ broken');
    try {
      await expect(new ClaudeCodeAdapter().approveProjectMcpServer('x', [root])).rejects.toThrow(/isn't valid JSON/);
      expect(await fsp.readFile(file, 'utf8')).toBe('{ broken');
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});

describe('mcpServerManager()', () => {
  it('leaves servers from the MCP config untagged', () => {
    expect(mcpServerManager('my-server')).toBeUndefined();
    expect(mcpServerManager('plugin')).toBeUndefined();
    expect(mcpServerManager('plugin:figma')).toBeUndefined();
  });

  it('keeps colons in the server part of a plugin server name', () => {
    expect(mcpServerManager('plugin:tools:a:b')).toMatchObject({ label: 'tools plugin' });
  });
});

describe('removeConfiguredMcpServer()', () => {
  it('points plugin servers at the plugin instead of failing name validation', async () => {
    await expect(new ClaudeCodeAdapter().removeConfiguredMcpServer('plugin:figma:figma'))
      .rejects.toThrow(/figma plugin.*disable or uninstall the plugin/);
  });

  it('points claude.ai connectors at claude.ai', async () => {
    await expect(new ClaudeCodeAdapter().removeConfiguredMcpServer('claude.ai Gmail'))
      .rejects.toThrow(/claude\.ai.*connectors on claude\.ai/);
  });
});

describe('buildMcpAddArgs()', () => {
  it('builds an http add command', () => {
    expect(buildMcpAddArgs({ name: 'sentry', transport: 'http', commandOrUrl: 'https://mcp.sentry.dev/mcp', scope: 'user' }))
      .toEqual(['mcp', 'add', '-s', 'user', '-t', 'http', 'sentry', 'https://mcp.sentry.dev/mcp']);
  });

  it('builds a stdio add command with env, args, and the -- separator', () => {
    expect(buildMcpAddArgs({
      name: 'my-server',
      transport: 'stdio',
      commandOrUrl: 'npx',
      args: ['-y', 'my-mcp-server'],
      env: { API_KEY: 'xxx' },
      scope: 'local',
    })).toEqual(['mcp', 'add', '-s', 'local', '-t', 'stdio', '-e', 'API_KEY=xxx', 'my-server', '--', 'npx', '-y', 'my-mcp-server']);
  });

  it('quotes header values containing spaces', () => {
    const args = buildMcpAddArgs({
      name: 's',
      transport: 'http',
      commandOrUrl: 'https://x.example/mcp',
      headers: ['Authorization: Bearer abc'],
      scope: 'user',
    });
    expect(args).toContain('"Authorization: Bearer abc"');
  });

  it('rejects unsafe server names and env keys', () => {
    expect(() => buildMcpAddArgs({ name: 'bad name', transport: 'http', commandOrUrl: 'https://x', scope: 'user' })).toThrow();
    expect(() => buildMcpAddArgs({ name: 'ok', transport: 'stdio', commandOrUrl: 'npx', env: { 'BAD KEY': 'v' }, scope: 'user' })).toThrow();
  });
});

describe('plugin and scope arguments for the claude CLI', () => {
  it('accepts plugin ids as the CLI lists them', () => {
    expect(validatePluginId('code-review@claude-plugins-official')).toBe('code-review@claude-plugins-official');
    expect(validatePluginId('figma')).toBe('figma');
  });

  it('refuses plugin ids with shell characters, spaces or a leading dash', () => {
    for (const id of ['a&b', 'a|b', 'a b', 'a"b', '%x%', '-rf', '', 42]) {
      expect(() => validatePluginId(id), String(id)).toThrow('Invalid plugin id');
    }
  });

  it('refuses unknown scopes and transports', () => {
    expect(validateConfigScope('project')).toBe('project');
    expect(() => validateConfigScope('user & x')).toThrow('Invalid scope');
    expect(() => buildMcpAddArgs({ name: 'ok', transport: 'http', commandOrUrl: 'https://x', scope: 'global' as never })).toThrow('Invalid scope');
    expect(() => buildMcpAddArgs({ name: 'ok', transport: 'ws' as never, commandOrUrl: 'https://x', scope: 'user' })).toThrow('Invalid transport');
  });

  it('refuses a bad plugin id before running the CLI', async () => {
    const adapter = new ClaudeCodeAdapter();
    await expect(adapter.installPlugin('x & y')).rejects.toThrow('Invalid plugin id');
    await expect(adapter.installPlugin('ok', 'all')).rejects.toThrow('Invalid scope');
    await expect(adapter.disablePlugin('x|y')).rejects.toThrow('Invalid plugin id');
  });
});

describe('quoteArg()', () => {
  it('passes simple args through unquoted', () => {
    expect(quoteArg('npx')).toBe('npx');
    expect(quoteArg('https://x.example/mcp')).toBe('https://x.example/mcp');
  });

  it('wraps args with spaces in double quotes', () => {
    expect(quoteArg('has space')).toBe('"has space"');
  });

  it('rejects args that could defeat quoting', () => {
    expect(() => quoteArg('a"b')).toThrow();
    expect(() => quoteArg('%PATH%')).toThrow();
  });
});

describe('MCP support', () => {
  it('offers every live control and describes its own rules', () => {
    const { mcp } = new ClaudeCodeAdapter();
    expect(mcp.controls).toEqual({ list: true, reconnect: true, toggle: true, signIn: true, contextCost: true });
    expect(mcp.disconnectHint).toMatch(/this project/);
    expect(mcp.config?.approvalHint).toMatch(/\.mcp\.json/);
    // The name rule is the CLI's own, which rejects dots
    const name = new RegExp(mcp.config!.namePattern);
    expect(name.test('my-server_1')).toBe(true);
    expect(name.test('my.server')).toBe(false);
  });

  it('labels where a live server comes from, trusting source over scope', () => {
    expect(claudeMcpOrigin({ source: 'sdk' })).toBe('Grove Bench');
    expect(claudeMcpOrigin({ source: 'claudeai', scope: 'user' })).toBe('claude.ai');
    expect(claudeMcpOrigin({ scope: 'project' })).toBe('project');
    expect(claudeMcpOrigin({})).toBeUndefined();
  });
});

describe('supportsLargeContext()', () => {
  it('opts every non-Haiku model into the 1M-context beta', () => {
    for (const m of new ClaudeCodeAdapter().getModels()) {
      const expected = !m.id.startsWith('claude-haiku');
      expect(supportsLargeContext(m.id), m.id).toBe(expected);
    }
  });

  it('skips the beta for Haiku (200k-only)', () => {
    expect(supportsLargeContext('claude-haiku-4-5-20251001')).toBe(false);
  });

  it('opts in when the model is unset (SDK default is 1M-capable)', () => {
    expect(supportsLargeContext(undefined)).toBe(true);
  });

  it('exposes the current 1M beta flag', () => {
    expect(CONTEXT_1M_BETA).toBe('context-1m-2025-08-07');
  });
});

// ─── transformMessage ───

function makeCtx() {
  return { toolUseMap: new Map<string, string>() };
}

describe('capToolResult()', () => {
  it('returns short results unchanged', () => {
    expect(capToolResult('hello')).toBe('hello');
    const exact = 'x'.repeat(200_000);
    expect(capToolResult(exact)).toBe(exact);
  });

  it('keeps the head and tail of an oversized result with an omission marker', () => {
    const big = 'H'.repeat(150_000) + 'M'.repeat(1_000_000) + 'T'.repeat(50_000);
    const capped = capToolResult(big);
    expect(capped.length).toBeLessThan(big.length);
    expect(capped.startsWith('H'.repeat(150_000))).toBe(true);
    expect(capped.endsWith('T'.repeat(50_000))).toBe(true);
    expect(capped).toContain('characters omitted');
    expect(capped).not.toContain('MMMMMMMMMMMMMMMMMMMM' + 'M'.repeat(999_980));
  });

  it('applies the cap to tool_result blocks', () => {
    const ctx = { toolUseMap: new Map<string, string>() };
    const events = transformMessage({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'a'.repeat(300_000) }] },
    } as any, ctx as any);
    const result = events.find((e) => e.type === 'tool_result') as Extract<AgentEvent, { type: 'tool_result' }>;
    expect(result.content.length).toBeLessThan(300_000);
    expect(result.content).toContain('characters omitted');
  });
});

describe('transformMessage()', () => {
  describe('informational messages', () => {
    it('shows the CLI\'s warnings, such as a sandbox that could not start', () => {
      const events = transformMessage(
        { type: 'system', subtype: 'informational', level: 'warning', content: ' Sandbox unavailable; running commands unsandboxed ' } as any,
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'status', level: 'warning', message: 'Sandbox unavailable; running commands unsandboxed' }]);
    });

    it('drops lower levels, which the CLI itself keeps to the transcript', () => {
      for (const level of ['info', 'notice', 'suggestion']) {
        expect(transformMessage({ type: 'system', subtype: 'informational', level, content: 'x' } as any, makeCtx())).toEqual([]);
      }
    });
  });

  describe('background task messages', () => {
    it('maps background_tasks_changed to a replace-style task list, dropping ambient tasks', () => {
      const events = transformMessage(
        {
          type: 'system',
          subtype: 'background_tasks_changed',
          tasks: [
            { task_id: 'a1', task_type: 'local_agent', description: 'Explore repo' },
            { task_id: 'w1', task_type: 'monitor', description: 'watcher', ambient: true },
          ],
        } as any,
        makeCtx(),
      );
      expect(events).toEqual([{
        type: 'background_tasks_changed',
        tasks: [{ taskId: 'a1', taskType: 'local_agent', description: 'Explore repo' }],
      }]);
    });

    it('maps an empty background_tasks_changed list', () => {
      const events = transformMessage(
        { type: 'system', subtype: 'background_tasks_changed', tasks: [] } as any,
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'background_tasks_changed', tasks: [] }]);
    });

    it('skips ambient task_started and task_notification messages', () => {
      expect(transformMessage(
        { type: 'system', subtype: 'task_started', task_id: 'w1', description: 'watcher', ambient: true } as any,
        makeCtx(),
      )).toEqual([]);
      expect(transformMessage(
        { type: 'system', subtype: 'task_notification', task_id: 'w1', status: 'completed', summary: '', output_file: '', ambient: true } as any,
        makeCtx(),
      )).toEqual([]);
    });

    it('still maps non-ambient task_started and stopped task_notification', () => {
      expect(transformMessage(
        { type: 'system', subtype: 'task_started', task_id: 'a1', description: 'Explore', task_type: 'local_agent' } as any,
        makeCtx(),
      )).toEqual([{ type: 'task_started', taskId: 'a1', toolUseId: undefined, description: 'Explore', taskType: 'local_agent' }]);
      const events = transformMessage(
        { type: 'system', subtype: 'task_notification', task_id: 'a1', status: 'stopped', summary: 'Stopped by user', output_file: '/tmp/o' } as any,
        makeCtx(),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'task_notification', taskId: 'a1', taskStatus: 'stopped', summary: 'Stopped by user' });
    });
  });

  describe('system messages', () => {
    it('transforms init into system_init', () => {
      const events = transformMessage(
        { type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-4-6', tools: ['Bash', 'Read'] } as any,
        makeCtx(),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'system_init',
        sessionId: 's1',
        model: 'claude-opus-4-6',
      });
    });

    it('transforms compact_boundary with metadata', () => {
      const events = transformMessage(
        { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 150000 } } as any,
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'compact_boundary', trigger: 'auto', preTokens: 150000 }]);
    });

    it('transforms compact_boundary with missing metadata gracefully', () => {
      const events = transformMessage(
        { type: 'system', subtype: 'compact_boundary' } as any,
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'compact_boundary', trigger: 'manual', preTokens: 0 }]);
    });

    it('extracts mode_sync from status message (camelCase)', () => {
      const events = transformMessage(
        { type: 'system', subtype: 'status', permissionMode: 'plan' } as any,
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'mode_sync', mode: 'plan', source: 'sdk' });
    });

    it('extracts mode_sync from status message (snake_case)', () => {
      const events = transformMessage(
        { type: 'system', subtype: 'status', permission_mode: 'default' } as any,
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'mode_sync', mode: 'default', source: 'sdk' });
    });

    it('reports SDK acceptEdits as readSafe while Grove is in read-safe mode', () => {
      const ctx = { ...makeCtx(), groveMode: 'readSafe' as const };
      const events = transformMessage(
        { type: 'system', subtype: 'status', permissionMode: 'acceptEdits' } as any,
        ctx,
      );
      expect(events).toContainEqual({ type: 'mode_sync', mode: 'readSafe', source: 'sdk' });
      // Outside read-safe mode the SDK's acceptEdits is just acceptEdits.
      expect(fromSdkSyncMode('acceptEdits', makeCtx())).toBe('acceptEdits');
    });

    it('passes native auto mode through to and from the SDK untouched', () => {
      expect(toSdkPermissionMode('auto')).toBe('auto');
      expect(toSdkPermissionMode('readSafe')).toBe('acceptEdits');
      expect(toSdkPermissionMode('plan')).toBe('plan');
      const events = transformMessage(
        { type: 'system', subtype: 'status', permissionMode: 'auto' } as any,
        { ...makeCtx(), groveMode: 'auto' as const },
      );
      expect(events).toContainEqual({ type: 'mode_sync', mode: 'auto', source: 'sdk' });
    });

    it('surfaces classifier denials as a status line with ANSI stripped', () => {
      const events = transformMessage(
        {
          type: 'system', subtype: 'permission_denied', tool_name: 'Bash',
          decision_reason_type: 'classifier', decision_reason: '\x1b[31mforce push\x1b[0m outside scope',
          message: 'denied',
        } as any,
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'status', message: 'Auto mode blocked Bash: force push outside scope' });
      expect(stripAnsi('plain')).toBe('plain');
    });

    it('detects plan mode from local_command_output', () => {
      const events = transformMessage(
        { type: 'system', subtype: 'local_command_output', content: 'Switched to plan mode' } as any,
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'mode_sync', mode: 'plan', source: 'sdk' });
    });

    it('emits compacting status', () => {
      const events = transformMessage(
        { type: 'system', subtype: 'status', status: 'compacting' } as any,
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'status', message: 'Compacting conversation...' });
    });
  });

  describe('assistant messages', () => {
    it('transforms text blocks', () => {
      const events = transformMessage(
        {
          type: 'assistant',
          uuid: 'u1',
          message: { content: [{ type: 'text', text: 'Hello world' }] },
        } as any,
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'assistant_text', text: 'Hello world', uuid: 'u1' });
    });

    it('transforms tool_use blocks and registers in toolUseMap', () => {
      const ctx = makeCtx();
      const events = transformMessage(
        {
          type: 'assistant',
          uuid: 'u2',
          message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] },
        } as any,
        ctx,
      );
      expect(events).toContainEqual({
        type: 'assistant_tool_use',
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        toolUseId: 'tu1',
        uuid: 'u2',
        toolCategory: 'bash',
      });
      expect(ctx.toolUseMap.get('tu1')).toBe('Bash');
    });

    it('puts PowerShell in the shell category', () => {
      const events = transformMessage(
        {
          type: 'assistant',
          uuid: 'u2',
          message: { content: [{ type: 'tool_use', id: 'tu1', name: 'PowerShell', input: { command: 'Get-ChildItem' } }] },
        } as any,
        makeCtx(),
      );
      expect(events).toContainEqual(expect.objectContaining({ type: 'assistant_tool_use', toolName: 'PowerShell', toolCategory: 'bash' }));
    });

    it('transforms thinking blocks', () => {
      const events = transformMessage(
        {
          type: 'assistant',
          uuid: 'u3',
          message: { content: [{ type: 'thinking', thinking: 'Let me think...' }] },
        } as any,
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'thinking', thinking: 'Let me think...', uuid: 'u3' });
    });

    it('extracts usage from assistant message', () => {
      const events = transformMessage(
        {
          type: 'assistant',
          uuid: 'u4',
          message: {
            content: [{ type: 'text', text: 'hi' }],
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 },
          },
        } as any,
        makeCtx(),
      );
      const usage = events.find((e) => e.type === 'usage');
      expect(usage).toMatchObject({
        type: 'usage',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 10,
      });
    });

    it('ignores usage from subagent assistant messages (parent_tool_use_id set)', () => {
      const events = transformMessage(
        {
          type: 'assistant',
          uuid: 'u5',
          parent_tool_use_id: 'tu-agent-123',
          message: {
            content: [{ type: 'text', text: 'subagent reply' }],
            usage: { input_tokens: 200, output_tokens: 30 },
          },
        } as any,
        makeCtx(),
      );
      expect(events.find((e) => e.type === 'usage')).toBeUndefined();
      // text should still come through
      expect(events.find((e) => e.type === 'assistant_text')).toMatchObject({ text: 'subagent reply' });
    });
  });

  describe('user messages (tool results)', () => {
    it('transforms tool_result blocks', () => {
      const events = transformMessage(
        {
          type: 'user',
          message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file contents', is_error: false }] },
        } as any,
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'tool_result', toolUseId: 'tu1', content: 'file contents', isError: false }]);
    });

    it('handles array content in tool_result', () => {
      const events = transformMessage(
        {
          type: 'user',
          message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', content: [{ text: 'part1' }, { text: 'part2' }], is_error: false }] },
        } as any,
        makeCtx(),
      );
      expect(events[0]).toMatchObject({ content: 'part1part2' });
    });
  });

  describe('result messages', () => {
    it('picks contextWindow from the dominant model, not the first modelUsage entry', () => {
      const events = transformMessage(
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          num_turns: 1,
          // Helper model (title generation) listed first with tiny usage —
          // its 200k window must not shadow the session model's 1M.
          modelUsage: {
            'claude-haiku-4-5-20251001': {
              inputTokens: 521, outputTokens: 12,
              cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
              contextWindow: 200_000,
            },
            'claude-opus-5': {
              inputTokens: 2, outputTokens: 4,
              cacheReadInputTokens: 20587, cacheCreationInputTokens: 14163,
              contextWindow: 1_000_000,
            },
          },
        } as any,
        makeCtx(),
      );
      expect(events[0]).toMatchObject({ type: 'result', contextWindow: 1_000_000 });
    });

    it('transforms result with cost and duration', () => {
      const events = transformMessage(
        {
          type: 'result',
          subtype: 'success',
          result: 'Done',
          total_cost_usd: 0.05,
          duration_ms: 3000,
          is_error: false,
          num_turns: 3,
        } as any,
        makeCtx(),
      );
      expect(events[0]).toMatchObject({
        type: 'result',
        subtype: 'success',
        totalCostUsd: 0.05,
        durationMs: 3000,
        isError: false,
        numTurns: 3,
      });
    });
  });

  describe('stream_event messages', () => {
    it('transforms text_delta', () => {
      const events = transformMessage(
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
        } as any,
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'partial_text', text: 'hi' }]);
    });

    it('transforms thinking_delta', () => {
      const events = transformMessage(
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } },
        } as any,
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'partial_thinking', text: 'hmm' }]);
    });
  });

  describe('unknown message types', () => {
    it('returns empty array for unknown type', () => {
      const events = transformMessage({ type: 'unknown_type' } as any, makeCtx());
      expect(events).toEqual([]);
    });
  });
});
