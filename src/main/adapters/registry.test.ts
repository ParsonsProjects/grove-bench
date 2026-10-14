import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentAdapter } from './types.js';

// index.ts registers the real adapters; only the registry and the default
// agent rules are under test here.
vi.mock('./claude-code.js', () => ({ ClaudeCodeAdapter: class {} }));
vi.mock('./acp/acp-adapter.js', () => ({ AcpAdapter: class {} }));
vi.mock('./acp/presets.js', () => ({ ACP_PRESETS: [], customAcpAgents: () => [] }));

import { adapterRegistry } from './registry.js';
import { followDefaultAgent, pickedDefaultAgent } from './index.js';
import type { GroveBenchSettings } from '../../shared/types.js';

const agent = (id: string, extra: Partial<AgentAdapter> = {}) => ({ id, displayName: id, ...extra }) as AgentAdapter;

// The registry is a singleton: register once, in the order the app does.
adapterRegistry.register(agent('claude-code'));
adapterRegistry.register(agent('gemini-cli'));
adapterRegistry.register(agent('opencode', { stage: 'alpha' }));
adapterRegistry.register(agent('claude-account-work', { account: { name: 'Work', configDir: '/h/.claude-work' } }));

type DefaultSettings = Pick<GroveBenchSettings, 'defaultAgent' | 'enabledAlphaAgents' | 'claudeAccounts'>;
let settings: DefaultSettings;

beforeEach(() => {
  settings = { defaultAgent: '', enabledAlphaAgents: [], claudeAccounts: [] };
  followDefaultAgent(() => settings as GroveBenchSettings);
});

describe('adapterRegistry default', () => {
  it('is the first registered agent until the user picks one', () => {
    expect(adapterRegistry.getDefault().id).toBe('claude-code');
    expect(adapterRegistry.getBuiltInDefault().id).toBe('claude-code');
  });

  it("follows the user's pick as soon as it changes, keeping the built-in default apart", () => {
    settings.defaultAgent = 'gemini-cli';
    expect(adapterRegistry.getDefault().id).toBe('gemini-cli');
    expect(adapterRegistry.getBuiltInDefault().id).toBe('claude-code');
    settings.defaultAgent = '';
    expect(adapterRegistry.getDefault().id).toBe('claude-code');
  });
});

describe('pickedDefaultAgent', () => {
  it('is null when nothing is picked, or the pick is not registered', () => {
    expect(pickedDefaultAgent(settings)).toBeNull();
    expect(pickedDefaultAgent({ ...settings, defaultAgent: 'gone-agent' })).toBeNull();
  });

  it('takes an alpha agent only while the user has it turned on', () => {
    expect(pickedDefaultAgent({ ...settings, defaultAgent: 'opencode' })).toBeNull();
    expect(pickedDefaultAgent({ ...settings, defaultAgent: 'opencode', enabledAlphaAgents: ['opencode'] })).toBe('opencode');
  });

  it('takes another Claude account only while it is in Settings', () => {
    expect(pickedDefaultAgent({ ...settings, defaultAgent: 'claude-account-work' })).toBeNull();
    const claudeAccounts = [{ id: 'work', name: 'Work', configDir: '/h/.claude-work' }];
    expect(pickedDefaultAgent({ ...settings, defaultAgent: 'claude-account-work', claudeAccounts })).toBe('claude-account-work');
  });
});
