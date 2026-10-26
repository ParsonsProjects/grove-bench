import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { transformMessage, isPathInside, ClaudeCodeAdapter, supportsLargeContext, CONTEXT_1M_BETA, THINKING_LEVEL_TOKENS, thinkingConfigFor, parseMcpListOutput, mcpServerManager, claudeMcpOrigin, mcpToolServerKey, mcpContextCostByServer, toMcpElicitationRequest, withMcpjsonApproval, mcpjsonApprovalsFrom, withoutLegacyDenyRules, buildMcpAddArgs, quoteArg, validatePluginId, validateConfigScope, claudeControlsFor, supportsAdaptiveThinking, supportsFastMode, supportsAutoMode, claudeModelCaps, effortFor, reasoningOptionsFor, toSdkPermissionMode, fromSdkSyncMode, stripAnsi, mapClaudeUsage, thinkingDisplayFor, TEXT_GENERATION_OPTIONS, missingConversationError, userMessageContent, sandboxDecision } from './claude-code.js';
import type { AgentEvent } from '../../shared/types.js';
import { RunningCost, RunningTokens } from './running-cost.js';
import { limitHook, LIMIT_STOP_REASON, titleListOptions, titleFromSessions } from './claude-code.js';
import type { MessageFile } from './types.js';
import type { HookInput, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

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
    // Opus 5.5 can't turn thinking off: a carried-over 'off' is not sent, but
    // adaptive is, so the thinking display can be set.
    expect(reasoningOptionsFor('claude-opus-5-5', { thinking: 'off', effort: 'medium' }))
      .toEqual({ thinking: { type: 'adaptive', display: 'summarized' }, effort: 'medium' });
    expect(reasoningOptionsFor('claude-fable-5', undefined))
      .toEqual({ thinking: { type: 'adaptive', display: 'summarized' }, effort: undefined });
    expect(reasoningOptionsFor('claude-haiku-4-5-20251001', { thinking: 'low', effort: 'high' }))
      .toEqual({ thinking: { type: 'enabled', budgetTokens: THINKING_LEVEL_TOKENS.low, display: 'summarized' }, effort: undefined });
    expect(reasoningOptionsFor('claude-opus-5', undefined)).toEqual({ thinking: null, effort: undefined });
  });

  it('asks for no thinking text when summaries are turned off', () => {
    expect(reasoningOptionsFor('claude-opus-5-5', {}, undefined, 'omitted').thinking)
      .toEqual({ type: 'adaptive', display: 'omitted' });
    expect(reasoningOptionsFor('claude-opus-5', { thinking: 'adaptive' }, undefined, 'omitted').thinking)
      .toEqual({ type: 'adaptive', display: 'omitted' });
    expect(reasoningOptionsFor('claude-opus-5', { thinking: 'off' }, undefined, 'omitted').thinking)
      .toEqual({ type: 'disabled' });
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

  it('maps adaptive to the adaptive thinking config with summaries shown', () => {
    expect(thinkingConfigFor('adaptive')).toEqual({ type: 'adaptive', display: 'summarized' });
  });

  it('maps off to disabled', () => {
    expect(thinkingConfigFor('off')).toEqual({ type: 'disabled' });
  });

  it('passes the display it is given', () => {
    expect(thinkingConfigFor('adaptive', 'omitted')).toEqual({ type: 'adaptive', display: 'omitted' });
    expect(thinkingConfigFor('low', 'omitted')).toEqual({ type: 'enabled', budgetTokens: THINKING_LEVEL_TOKENS.low, display: 'omitted' });
  });

  it('maps low/medium to fixed budgets', () => {
    expect(thinkingConfigFor('low')).toEqual({ type: 'enabled', budgetTokens: THINKING_LEVEL_TOKENS.low, display: 'summarized' });
    expect(thinkingConfigFor('medium')).toEqual({ type: 'enabled', budgetTokens: THINKING_LEVEL_TOKENS.medium, display: 'summarized' });
  });
});

describe('thinkingDisplayFor()', () => {
  it('shows summaries unless the setting is turned off', () => {
    expect(thinkingDisplayFor(true)).toBe('summarized');
    expect(thinkingDisplayFor(undefined)).toBe('summarized');
    expect(thinkingDisplayFor(false)).toBe('omitted');
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
      expect(await read(fresh)).toMatchObject({ enabledMcpjsonServers: ['repo-tools'] });
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

describe('worktree deny rules', () => {
  const legacy = ['Read(../../**)', 'Edit(../../**)'];

  it('writes no deny rules into a new worktree', async () => {
    const fsp = await import('node:fs/promises');
    const os = await import('node:os');
    const nodePath = await import('node:path');
    const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'grove-wt-'));
    try {
      await new ClaudeCodeAdapter().generateWorktreeSettings(root);
      const written = JSON.parse(await fsp.readFile(nodePath.join(root, '.claude', 'settings.local.json'), 'utf8'));
      expect(written).not.toHaveProperty('permissions');
      expect(written).toMatchObject({ attribution: { commit: '', pr: '' } });
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('drops only the old rules, keeping the rest of the file', () => {
    expect(withoutLegacyDenyRules({
      permissions: { deny: [...legacy, 'Read(./.env)'], allow: ['Bash(npm test)'] },
      attribution: { commit: '', pr: '' },
    })).toEqual({
      permissions: { deny: ['Read(./.env)'], allow: ['Bash(npm test)'] },
      attribution: { commit: '', pr: '' },
    });
    expect(withoutLegacyDenyRules({ permissions: { deny: legacy, allow: ['Bash(ls)'] } })).toEqual({ permissions: { allow: ['Bash(ls)'] } });
    expect(withoutLegacyDenyRules({ permissions: { deny: legacy }, enabledMcpjsonServers: ['a'] })).toEqual({ enabledMcpjsonServers: ['a'] });
  });

  it('leaves settings without the old rules alone', () => {
    expect(withoutLegacyDenyRules({})).toBeNull();
    expect(withoutLegacyDenyRules({ permissions: { deny: ['Read(./.env)'] } })).toBeNull();
    expect(withoutLegacyDenyRules({ permissions: { deny: 'Read(../../**)' } })).toBeNull();
    expect(withoutLegacyDenyRules({ permissions: ['Read(../../**)'] })).toBeNull();
  });

  it('updates an existing worktree, and writes nothing when there is nothing to change', async () => {
    const fsp = await import('node:fs/promises');
    const os = await import('node:os');
    const nodePath = await import('node:path');
    const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'grove-wt-'));
    const file = nodePath.join(root, '.claude', 'settings.local.json');
    const adapter = new ClaudeCodeAdapter();
    try {
      await adapter.updateWorktreeSettings(root);
      await expect(fsp.access(file)).rejects.toThrow();

      await fsp.mkdir(nodePath.dirname(file), { recursive: true });
      await fsp.writeFile(file, JSON.stringify({ permissions: { deny: legacy }, enabledMcpjsonServers: ['a'] }));
      await adapter.updateWorktreeSettings(root);
      expect(JSON.parse(await fsp.readFile(file, 'utf8'))).toEqual({ enabledMcpjsonServers: ['a'] });

      await fsp.writeFile(file, '{"keep":true}');
      await adapter.updateWorktreeSettings(root);
      expect(await fsp.readFile(file, 'utf8')).toBe('{"keep":true}');
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("doesn't overwrite a worktree settings file it can't parse", async () => {
    const fsp = await import('node:fs/promises');
    const os = await import('node:os');
    const nodePath = await import('node:path');
    const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'grove-wt-'));
    const file = nodePath.join(root, '.claude', 'settings.local.json');
    await fsp.mkdir(nodePath.dirname(file), { recursive: true });
    await fsp.writeFile(file, '{ broken');
    try {
      await expect(new ClaudeCodeAdapter().updateWorktreeSettings(root)).rejects.toThrow(/isn't valid JSON/);
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

/** An SDK message as these tests give it: only the fields transformMessage
 *  reads, and sometimes an old or unknown shape the SDK's types don't have. */
const sdk = (message: object) => message as SDKMessage;

describe('missingConversationError()', () => {
  // What the CLI sends when asked to resume a conversation it no longer has.
  const missing = {
    type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 0,
    errors: ['No conversation found with session ID: 1498a621-d151-4ae3-9f13-7416cfbdf170'],
  };

  it('picks out the missing-conversation error result', () => {
    expect(missingConversationError(sdk(missing))).toBe('No conversation found with session ID: 1498a621-d151-4ae3-9f13-7416cfbdf170');
    // Still recognised if a CLI version prefixes the text.
    expect(missingConversationError(sdk({ ...missing, errors: ['Error: No conversation found with session ID: x'] })))
      .toBe('Error: No conversation found with session ID: x');
  });

  it('ignores other results', () => {
    expect(missingConversationError(sdk({ ...missing, errors: ['Request was aborted'] }))).toBeNull();
    expect(missingConversationError(sdk({ type: 'result', subtype: 'success', is_error: false, result: 'No conversation found with session ID: x' }))).toBeNull();
    expect(missingConversationError(sdk({ type: 'assistant', message: { content: [] } }))).toBeNull();
  });
});

describe('transformMessage() tool results', () => {
  it('passes on the images in a tool result (a screenshot, an image file read)', () => {
    const ctx = { toolUseMap: new Map<string, string>() };
    const events = transformMessage(sdk({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'tu1',
          content: [
            { type: 'text', text: 'Screenshot of the page' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
            // MCP shape, in case it arrives unconverted
            { type: 'image', data: '/9j/4', mimeType: 'image/jpeg' },
            // Not an image type the thread can show
            { type: 'image', source: { type: 'base64', media_type: 'image/tiff', data: 'SUkq' } },
          ],
        }],
      },
    }), ctx);

    expect(events).toEqual([{
      type: 'tool_result',
      toolUseId: 'tu1',
      content: 'Screenshot of the page',
      isError: undefined,
      imageData: [
        { data: 'iVBOR', mediaType: 'image/png' },
        { data: '/9j/4', mediaType: 'image/jpeg' },
      ],
    }]);
  });

  it('leaves imageData off a tool result without images', () => {
    const ctx = { toolUseMap: new Map<string, string>() };
    const events = transformMessage(sdk({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: 'ok' }] }] },
    }), ctx);
    expect(events[0]).not.toHaveProperty('imageData');
  });
});

describe('transformMessage()', () => {
  describe('informational messages', () => {
    it('shows the CLI\'s warnings, such as a sandbox that could not start', () => {
      const events = transformMessage(
        sdk({ type: 'system', subtype: 'informational', level: 'warning', content: ' Sandbox unavailable; running commands unsandboxed ' }),
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'status', level: 'warning', message: 'Sandbox unavailable; running commands unsandboxed' }]);
    });

    it('drops lower levels, which the CLI itself keeps to the transcript', () => {
      for (const level of ['info', 'notice', 'suggestion']) {
        expect(transformMessage(sdk({ type: 'system', subtype: 'informational', level, content: 'x' }), makeCtx())).toEqual([]);
      }
    });
  });

  describe('background task messages', () => {
    it('maps background_tasks_changed to a replace-style task list, dropping ambient tasks', () => {
      const events = transformMessage(
        sdk({
          type: 'system',
          subtype: 'background_tasks_changed',
          tasks: [
            { task_id: 'a1', task_type: 'local_agent', description: 'Explore repo' },
            { task_id: 'w1', task_type: 'monitor', description: 'watcher', ambient: true },
          ],
        }),
        makeCtx(),
      );
      expect(events).toEqual([{
        type: 'background_tasks_changed',
        tasks: [{ taskId: 'a1', taskType: 'local_agent', description: 'Explore repo' }],
      }]);
    });

    it('maps an empty background_tasks_changed list', () => {
      const events = transformMessage(
        sdk({ type: 'system', subtype: 'background_tasks_changed', tasks: [] }),
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'background_tasks_changed', tasks: [] }]);
    });

    it('skips ambient task_started and task_notification messages', () => {
      expect(transformMessage(
        sdk({ type: 'system', subtype: 'task_started', task_id: 'w1', description: 'watcher', ambient: true }),
        makeCtx(),
      )).toEqual([]);
      expect(transformMessage(
        sdk({ type: 'system', subtype: 'task_notification', task_id: 'w1', status: 'completed', summary: '', output_file: '', ambient: true }),
        makeCtx(),
      )).toEqual([]);
    });

    it('still maps non-ambient task_started and stopped task_notification', () => {
      expect(transformMessage(
        sdk({ type: 'system', subtype: 'task_started', task_id: 'a1', description: 'Explore', task_type: 'local_agent' }),
        makeCtx(),
      )).toEqual([{ type: 'task_started', taskId: 'a1', toolUseId: undefined, description: 'Explore', taskType: 'local_agent' }]);
      const events = transformMessage(
        sdk({ type: 'system', subtype: 'task_notification', task_id: 'a1', status: 'stopped', summary: 'Stopped by user', output_file: '/tmp/o' }),
        makeCtx(),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'task_notification', taskId: 'a1', taskStatus: 'stopped', summary: 'Stopped by user' });
    });
  });

  describe('system messages', () => {
    it('transforms init into system_init', () => {
      const events = transformMessage(
        sdk({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-4-6', tools: ['Bash', 'Read'] }),
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
        sdk({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 150000 } }),
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'compact_boundary', trigger: 'auto', preTokens: 150000 }]);
    });

    it('transforms compact_boundary with missing metadata gracefully', () => {
      const events = transformMessage(
        sdk({ type: 'system', subtype: 'compact_boundary' }),
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'compact_boundary', trigger: 'manual', preTokens: 0 }]);
    });

    it('extracts mode_sync from status message (camelCase)', () => {
      const events = transformMessage(
        sdk({ type: 'system', subtype: 'status', permissionMode: 'plan' }),
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'mode_sync', mode: 'plan', source: 'sdk' });
    });

    it('extracts mode_sync from status message (snake_case)', () => {
      const events = transformMessage(
        sdk({ type: 'system', subtype: 'status', permission_mode: 'default' }),
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'mode_sync', mode: 'default', source: 'sdk' });
    });

    it('reports SDK acceptEdits as readSafe while Grove is in read-safe mode', () => {
      const ctx = { ...makeCtx(), groveMode: 'readSafe' as const };
      const events = transformMessage(
        sdk({ type: 'system', subtype: 'status', permissionMode: 'acceptEdits' }),
        ctx,
      );
      expect(events).toContainEqual({ type: 'mode_sync', mode: 'readSafe', source: 'sdk' });
      // Outside read-safe mode the SDK's acceptEdits is just acceptEdits.
      expect(fromSdkSyncMode('acceptEdits', makeCtx())).toBe('acceptEdits');
    });

    it("sends no mode_sync for an SDK mode Grove doesn't have", () => {
      expect(fromSdkSyncMode('bypassPermissions', makeCtx())).toBeNull();
      expect(fromSdkSyncMode('dontAsk', makeCtx())).toBeNull();
      const modeSyncs = (message: object) =>
        transformMessage(message as never, makeCtx()).filter((e) => e.type === 'mode_sync');
      expect(modeSyncs({ type: 'system', subtype: 'status', status: null, permissionMode: 'bypassPermissions' })).toEqual([]);
      // A system message with no case of its own still reports a mode Grove has.
      expect(modeSyncs({ type: 'system', subtype: 'not_a_real_subtype', mode: 'dontAsk' })).toEqual([]);
      expect(modeSyncs({ type: 'system', subtype: 'not_a_real_subtype', mode: 'plan' }))
        .toEqual([{ type: 'mode_sync', mode: 'plan', source: 'sdk' }]);
    });

    it('passes native auto mode through to and from the SDK untouched', () => {
      expect(toSdkPermissionMode('auto')).toBe('auto');
      expect(toSdkPermissionMode('readSafe')).toBe('acceptEdits');
      expect(toSdkPermissionMode('plan')).toBe('plan');
      const events = transformMessage(
        sdk({ type: 'system', subtype: 'status', permissionMode: 'auto' }),
        { ...makeCtx(), groveMode: 'auto' as const },
      );
      expect(events).toContainEqual({ type: 'mode_sync', mode: 'auto', source: 'sdk' });
    });

    it('surfaces classifier denials as a status line with ANSI stripped', () => {
      const events = transformMessage(
        sdk({
          type: 'system', subtype: 'permission_denied', tool_name: 'Bash',
          decision_reason_type: 'classifier', decision_reason: '\x1b[31mforce push\x1b[0m outside scope',
          message: 'denied',
        }),
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'status', message: 'Auto mode blocked Bash: force push outside scope' });
      expect(stripAnsi('plain')).toBe('plain');
    });

    it('detects plan mode from local_command_output', () => {
      const events = transformMessage(
        sdk({ type: 'system', subtype: 'local_command_output', content: 'Switched to plan mode' }),
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'mode_sync', mode: 'plan', source: 'sdk' });
    });

    it('emits compacting status', () => {
      const events = transformMessage(
        sdk({ type: 'system', subtype: 'status', status: 'compacting' }),
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'status', message: 'Compacting thread...' });
    });
  });

  describe('assistant messages', () => {
    it('transforms text blocks', () => {
      const events = transformMessage(
        sdk({
          type: 'assistant',
          uuid: 'u1',
          message: { content: [{ type: 'text', text: 'Hello world' }] },
        }),
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'assistant_text', text: 'Hello world', uuid: 'u1' });
    });

    it('transforms tool_use blocks and registers in toolUseMap', () => {
      const ctx = makeCtx();
      const events = transformMessage(
        sdk({
          type: 'assistant',
          uuid: 'u2',
          message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] },
        }),
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
        sdk({
          type: 'assistant',
          uuid: 'u2',
          message: { content: [{ type: 'tool_use', id: 'tu1', name: 'PowerShell', input: { command: 'Get-ChildItem' } }] },
        }),
        makeCtx(),
      );
      expect(events).toContainEqual(expect.objectContaining({ type: 'assistant_tool_use', toolName: 'PowerShell', toolCategory: 'bash' }));
    });

    it('transforms thinking blocks', () => {
      const events = transformMessage(
        sdk({
          type: 'assistant',
          uuid: 'u3',
          message: { content: [{ type: 'thinking', thinking: 'Let me think...' }] },
        }),
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'thinking', thinking: 'Let me think...', uuid: 'u3' });
    });

    it('extracts usage from assistant message', () => {
      const events = transformMessage(
        sdk({
          type: 'assistant',
          uuid: 'u4',
          message: {
            content: [{ type: 'text', text: 'hi' }],
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 },
          },
        }),
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
        sdk({
          type: 'assistant',
          uuid: 'u5',
          parent_tool_use_id: 'tu-agent-123',
          message: {
            content: [{ type: 'text', text: 'subagent reply' }],
            usage: { input_tokens: 200, output_tokens: 30 },
          },
        }),
        makeCtx(),
      );
      expect(events.find((e) => e.type === 'usage')).toBeUndefined();
    });

    it('tags a subagent\'s text, thinking and tool calls with its Agent call, in order', () => {
      // Untagged, a subagent's report read as the main agent's reply.
      const events = transformMessage(
        sdk({
          type: 'assistant',
          uuid: 'u6',
          parent_tool_use_id: 'tu-agent-123',
          message: {
            content: [
              { type: 'thinking', thinking: 'Spot-checking...' },
              { type: 'text', text: 'I\'ve sent the full report to your caller.' },
              { type: 'tool_use', id: 'tu-sub-1', name: 'Grep', input: { pattern: 'cron' } },
            ],
          },
        }),
        makeCtx(),
      );
      expect(events.map((e) => e.type)).toEqual(['thinking', 'assistant_text', 'assistant_tool_use']);
      for (const e of events) expect(e).toMatchObject({ parentToolUseId: 'tu-agent-123' });
    });

    it('leaves the main agent\'s events untagged', () => {
      const events = transformMessage(
        sdk({ type: 'assistant', uuid: 'u7', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'hi' }] } }),
        makeCtx(),
      );
      expect(events[0]).not.toHaveProperty('parentToolUseId');
    });
  });

  describe('user messages (tool results)', () => {
    it('transforms tool_result blocks', () => {
      const events = transformMessage(
        sdk({
          type: 'user',
          message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file contents', is_error: false }] },
        }),
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'tool_result', toolUseId: 'tu1', content: 'file contents', isError: false }]);
    });

    it('handles array content in tool_result', () => {
      const events = transformMessage(
        sdk({
          type: 'user',
          message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', content: [{ text: 'part1' }, { text: 'part2' }], is_error: false }] },
        }),
        makeCtx(),
      );
      expect(events[0]).toMatchObject({ content: 'part1part2' });
    });

    it('tags a subagent\'s tool results with its Agent call', () => {
      const events = transformMessage(
        sdk({
          type: 'user',
          parent_tool_use_id: 'tu-agent-123',
          message: { content: [{ type: 'tool_result', tool_use_id: 'tu-sub-1', content: 'match', is_error: false }] },
        }),
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'tool_result', toolUseId: 'tu-sub-1', content: 'match', isError: false, parentToolUseId: 'tu-agent-123' }]);
    });
  });

  describe('result messages', () => {
    it('picks contextWindow from the dominant model, not the first modelUsage entry', () => {
      const events = transformMessage(
        sdk({
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
        }),
        makeCtx(),
      );
      expect(events[0]).toMatchObject({ type: 'result', contextWindow: 1_000_000 });
    });

    it('transforms result with cost and duration', () => {
      const events = transformMessage(
        sdk({
          type: 'result',
          subtype: 'success',
          result: 'Done',
          total_cost_usd: 0.05,
          duration_ms: 3000,
          is_error: false,
          num_turns: 3,
        }),
        makeCtx(),
      );
      expect(events[0]).toMatchObject({
        type: 'result',
        subtype: 'success',
        totalCostUsd: 0.05,
        sessionCostUsd: 0.05,
        durationMs: 3000,
        isError: false,
        numTurns: 3,
      });
    });

    it('reports each turn\'s cost from the SDK\'s running total', () => {
      const ctx = { ...makeCtx(), cost: new RunningCost() };
      const result = (total: number) => transformMessage(
        sdk({ type: 'result', subtype: 'success', total_cost_usd: total, duration_ms: 1, is_error: false, num_turns: 1 }),
        ctx,
      )[0];
      expect(result(0.05)).toMatchObject({ totalCostUsd: 0.05, sessionCostUsd: 0.05 });
      const second = result(0.08) as Extract<AgentEvent, { type: 'result' }>;
      expect(second.totalCostUsd).toBeCloseTo(0.03);
      expect(second.sessionCostUsd).toBe(0.08);
    });

    it('reports each turn\'s tokens from modelUsage\'s running totals, cache and every model included', () => {
      const ctx = { ...makeCtx(), tokens: new RunningTokens() };
      const usage = (input: number, output: number) => ({
        'claude-opus-5-5': { inputTokens: input, outputTokens: output, cacheReadInputTokens: 1000, cacheCreationInputTokens: 100, contextWindow: 200_000 },
        'claude-haiku-5-5': { inputTokens: 5, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      });
      const result = (input: number, output: number) => transformMessage(
        sdk({ type: 'result', subtype: 'success', modelUsage: usage(input, output), duration_ms: 1, is_error: false, num_turns: 1 }),
        ctx,
      )[0] as Extract<AgentEvent, { type: 'result' }>;

      expect(result(10, 20)).toMatchObject({ turnTokens: { input: 1115, output: 21 }, sessionTokens: { input: 1115, output: 21 } });
      expect(result(40, 50)).toMatchObject({ turnTokens: { input: 30, output: 30 }, sessionTokens: { input: 1145, output: 51 } });
    });

    it('keeps the session totals through a zeroed error result, so a resume doesn\'t count earlier turns again', () => {
      const ctx = { ...makeCtx(), cost: new RunningCost(), tokens: new RunningTokens() };
      const usage = (input: number, output: number) => ({ 'claude-opus-5-5': { inputTokens: input, outputTokens: output, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } });
      const result = (usd: number, input: number, output: number, isError: boolean) => transformMessage(
        sdk({ type: 'result', subtype: isError ? 'error_during_execution' : 'success', total_cost_usd: usd, modelUsage: usage(input, output), duration_ms: 1, is_error: isError, num_turns: 1 }),
        ctx,
      )[0] as Extract<AgentEvent, { type: 'result' }>;

      result(0.5, 2000, 40, false);
      expect(result(0, 0, 0, true)).toMatchObject({
        totalCostUsd: 0, sessionCostUsd: 0.5,
        turnTokens: { input: 0, output: 0 }, sessionTokens: { input: 2000, output: 40 },
      });
    });

    it('counts afresh after /clear, even when the next turn reads more than the whole conversation before it', () => {
      const ctx = { ...makeCtx(), cost: new RunningCost(), tokens: new RunningTokens() };
      const usage = (input: number, output: number) => ({ 'claude-opus-5-5': { inputTokens: input, outputTokens: output, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } });
      const result = (usd: number, input: number, output: number) => transformMessage(
        sdk({ type: 'result', subtype: 'success', total_cost_usd: usd, modelUsage: usage(input, output), duration_ms: 1, is_error: false, num_turns: 1 }),
        ctx,
      )[0] as Extract<AgentEvent, { type: 'result' }>;

      result(0.1, 30_000, 500);
      transformMessage(sdk({ type: 'conversation_reset', trigger: 'clear', new_conversation_id: 'c2', uuid: 'u', session_id: 's2' }), ctx);
      expect(result(0.4, 175_000, 3000)).toMatchObject({
        totalCostUsd: 0.4, sessionCostUsd: 0.4,
        turnTokens: { input: 175_000, output: 3000 }, sessionTokens: { input: 175_000, output: 3000 },
      });
    });

    it('leaves the totals running through a reset other than /clear', () => {
      const ctx = { ...makeCtx(), cost: new RunningCost() };
      const result = (usd: number) => transformMessage(
        sdk({ type: 'result', subtype: 'success', total_cost_usd: usd, duration_ms: 1, is_error: false, num_turns: 1 }),
        ctx,
      )[0] as Extract<AgentEvent, { type: 'result' }>;

      result(0.1);
      transformMessage(sdk({ type: 'conversation_reset', trigger: 'plan_mode_exit', new_conversation_id: 'c2', uuid: 'u', session_id: 's2' }), ctx);
      expect(result(0.3).totalCostUsd).toBeCloseTo(0.2);
    });

    it('reports no tokens for a result without modelUsage', () => {
      const event = transformMessage(sdk({ type: 'result', subtype: 'success', duration_ms: 1, is_error: false, num_turns: 1 }), makeCtx())[0];
      expect(event).not.toHaveProperty('turnTokens');
    });
  });

  describe('stream_event messages', () => {
    it('transforms text_delta', () => {
      const events = transformMessage(
        sdk({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
        }),
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'partial_text', text: 'hi' }]);
    });

    it('transforms thinking_delta', () => {
      const events = transformMessage(
        sdk({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } },
        }),
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'partial_thinking', text: 'hmm' }]);
    });

    it('drops a subagent\'s stream, which would run into the main agent\'s reply', () => {
      for (const event of [
        { type: 'message_start' },
        { type: 'content_block_start', content_block: { type: 'text' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'sub' } },
      ]) {
        expect(transformMessage(sdk({ type: 'stream_event', parent_tool_use_id: 'tu-agent-123', event }), makeCtx())).toEqual([]);
      }
    });
  });

  describe('unknown message types', () => {
    it('returns empty array for unknown type', () => {
      const events = transformMessage(sdk({ type: 'unknown_type' }), makeCtx());
      expect(events).toEqual([]);
    });
  });
});

// ─── generateText options ───

describe('TEXT_GENERATION_OPTIONS', () => {
  it('gives the one-turn query no tools to call, so it cannot run out of turns', () => {
    expect(TEXT_GENERATION_OPTIONS.maxTurns).toBe(1);
    expect(TEXT_GENERATION_OPTIONS.tools).toEqual([]);
    // Project, user and plugin MCP servers would add tools back.
    expect(TEXT_GENERATION_OPTIONS.strictMcpConfig).toBe(true);
  });

  it('stays out of plan mode, whose reminder sends the model exploring', () => {
    expect(TEXT_GENERATION_OPTIONS.permissionMode).toBe('dontAsk');
  });
});

// ─── limitHook (Grove's limits, before each tool call) ───

describe('limitHook()', () => {
  const input: HookInput = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, tool_use_id: 'tu_1', session_id: 's', transcript_path: '', cwd: '' };
  const signal = new AbortController().signal;

  it('lets the call go ahead with no decision while no limit is reached', async () => {
    const before = vi.fn().mockResolvedValue('continue');
    await expect(limitHook(before)(input, 'tu_1', { signal })).resolves.toEqual({});
    expect(before).toHaveBeenCalledWith({ toolName: 'Bash', toolUseId: 'tu_1' });
  });

  it('denies the call when the user stops at a limit', async () => {
    const out = await limitHook(vi.fn().mockResolvedValue('stop'))(input, 'tu_1', { signal });
    expect(out).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: LIMIT_STOP_REASON },
    });
  });

  it('ignores other hook events', async () => {
    const before = vi.fn();
    await expect(limitHook(before)({ ...input, hook_event_name: 'PostToolUse' } as HookInput, 'tu_1', { signal })).resolves.toEqual({});
    expect(before).not.toHaveBeenCalled();
  });
});

// ─── userMessageContent (what the SDK is sent for a prompt) ───

describe('userMessageContent()', () => {
  function file(over: Partial<MessageFile> = {}): MessageFile {
    return { name: 'logs.zip', mediaType: 'application/zip', data: 'UEsD', path: 'C:\\att\\b.zip', size: 10, ...over };
  }

  it('is the plain text when nothing is attached', () => {
    expect(userMessageContent({ text: 'hello' })).toBe('hello');
  });

  it('puts images ahead of the text', () => {
    expect(userMessageContent({ text: 'look', images: [{ data: 'iVBOR', mediaType: 'image/png', name: 'a.png' }] })).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
      { type: 'text', text: 'look' },
    ]);
  });

  it('gives other files by path in a note ahead of the text', () => {
    const content = userMessageContent({ text: 'what failed?', files: [file()] });
    expect(typeof content).toBe('string');
    expect(content).toMatch(/^<attached_files>\n/);
    expect(content).toContain('<file name="logs.zip" type="application/zip" size="10" path="C:\\att\\b.zip" />');
    expect(content).toMatch(/<\/attached_files>\n\nwhat failed\?$/);
  });

  it('gives a PDF by path too, never as a document block', () => {
    const content = userMessageContent({ text: 'summarise', files: [file({ name: 'spec.pdf', mediaType: 'application/pdf' })] });
    expect(typeof content).toBe('string');
    expect(content).toContain('<file name="spec.pdf" type="application/pdf"');
  });

  it('puts the note in the text block when images are attached too', () => {
    const content = userMessageContent({
      text: 'go',
      images: [{ data: 'iVBOR', mediaType: 'image/png', name: 'a.png' }],
      files: [file({ name: 'a.mp3', mediaType: 'audio/mpeg' })],
    }) as Array<Record<string, unknown>>;
    expect(content.map((b) => b.type)).toEqual(['image', 'text']);
    expect(content[1].text).toContain('<file name="a.mp3" type="audio/mpeg"');
    expect(content[1].text).toMatch(/\n\ngo$/);
  });
});

// ─── sandboxDecision (Claude's checks in the shared tool policy) ───

describe('sandboxDecision()', () => {
  const cwd = path.resolve('/wt/abc');

  it('has nothing to say without a sandbox', () => {
    expect(sandboxDecision('Bash', { command: 'ls' }, { cwd, sandbox: null })).toBeNull();
    expect(sandboxDecision('Write', { file_path: '/etc/x' }, { cwd, sandbox: null })).toBeNull();
  });

  it('runs Bash without a prompt only when the sandbox opts in', () => {
    expect(sandboxDecision('Bash', { command: 'ls' }, { cwd, sandbox: { autoAllowBashIfSandboxed: true } })).toEqual({ behavior: 'allow' });
    expect(sandboxDecision('Bash', { command: 'ls' }, { cwd, sandbox: { autoAllowBashIfSandboxed: false } })).toBeNull();
  });

  it('refuses a file write outside the allowed folders, notebooks included', () => {
    const sandbox = { filesystem: { allowWrite: ['.'] } };
    expect(sandboxDecision('Edit', { file_path: 'src/a.ts' }, { cwd, sandbox })).toBeNull();
    expect(sandboxDecision('Write', { file_path: path.resolve('/elsewhere/a.ts') }, { cwd, sandbox })).toMatchObject({ behavior: 'deny', reason: 'guard' });
    expect(sandboxDecision('NotebookEdit', { notebook_path: '../out.ipynb' }, { cwd, sandbox })).toMatchObject({ behavior: 'deny' });
    expect(sandboxDecision('Read', { file_path: path.resolve('/elsewhere/a.ts') }, { cwd, sandbox })).toBeNull();
  });
});

describe('conversation titles', () => {
  it("lists only the thread's own folder, so the SDK starts no git", () => {
    // includeWorktrees would have the SDK run `git worktree list` from the
    // main process; programmatic sessions are Grove's own.
    expect(titleListOptions('C:\\wt\\a1')).toEqual({ dir: 'C:\\wt\\a1', includeWorktrees: false, includeProgrammatic: true });
  });

  it("takes the session's own title, tidied", () => {
    const sessions = [
      { sessionId: 'other', summary: 'x', lastModified: 2, customTitle: 'Not this one' },
      { sessionId: 'prov-1', summary: 'Fix the login', lastModified: 1, customTitle: '  Fix the\n login   redirect ' },
    ];
    expect(titleFromSessions(sessions, 'prov-1')).toBe('Fix the login redirect');
  });

  it('has no title for a session without one, or one not listed', () => {
    // `summary` falls back to prompt text, which Grove names threads from itself.
    expect(titleFromSessions([{ sessionId: 'prov-1', summary: 'Fix the login', lastModified: 1 }], 'prov-1')).toBeNull();
    expect(titleFromSessions([{ sessionId: 'prov-1', summary: '', lastModified: 1, customTitle: '   ' }], 'prov-1')).toBeNull();
    expect(titleFromSessions([], 'prov-1')).toBeNull();
  });
});
