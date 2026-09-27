import { describe, it, expect, vi } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { ClaudeCodeAdapter, FALLBACK_MODELS, modelsFromSdk, parseLearnedModels, type ModelCatalogStore } from './claude-code.js';
import { CONTROL_IDS } from '../../shared/types.js';

/** What the bundled CLI (agent SDK 0.3.281) returned from `supportedModels()`
 *  for an API-key account, captured from a real run. */
const SDK_ROWS = [
  { value: 'default', resolvedModel: 'claude-sonnet-5', displayName: 'Default (recommended)', description: 'Sonnet 5 · Efficient for routine tasks', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsAdaptiveThinking: true, supportsAutoMode: true },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet', description: 'Sonnet 5 · Efficient for routine tasks', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsAdaptiveThinking: true, supportsAutoMode: true },
  { value: 'claude-fable-5-1', resolvedModel: 'claude-fable-5-1', displayName: 'Fable', description: 'Fable 5.1 · Most capable for your hardest and longest-running tasks', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsAdaptiveThinking: true, supportsAutoMode: true },
  { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus', description: 'Opus 5.5 · Best for everyday, complex tasks', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsAdaptiveThinking: true, supportsFastMode: true, supportsAutoMode: true },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku', description: 'Haiku 4.5 · Fastest for quick answers' },
] as const;

function memoryStore(initial: unknown = null): ModelCatalogStore & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    load: () => initial,
    save: (_id, models) => { saved.push(models); },
  };
}

describe('modelsFromSdk()', () => {
  const models = modelsFromSdk(SDK_ROWS as never);

  it('keeps one row per concrete model, Opus first, without the "default" row', () => {
    expect(models.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-haiku-4-5-20251001']);
  });

  it('labels each model with its version, not just its family', () => {
    expect(models.map((m) => m.label)).toEqual(['Opus 5.5', 'Sonnet 5', 'Fable 5.1', 'Haiku 4.5']);
  });

  it('records aliases only where the SDK used one', () => {
    expect(models.map((m) => m.alias)).toEqual(['opus', 'sonnet', undefined, 'haiku']);
  });

  it('carries the capabilities the SDK reports, treating an omitted flag as unsupported', () => {
    const opus = models[0];
    expect(opus).toMatchObject({ fastMode: true, autoMode: true, adaptiveThinking: true, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] });
    const haiku = models[3];
    expect(haiku).toMatchObject({ fastMode: false, autoMode: false, adaptiveThinking: false, effortLevels: [] });
  });

  it('falls back to the display name when the description has no version', () => {
    const [m] = modelsFromSdk([{ value: 'claude-x', displayName: 'X Model', description: 'Something' }] as never);
    expect(m.label).toBe('X Model');
  });
});

describe('parseLearnedModels()', () => {
  it('accepts a saved list and rejects anything malformed or empty', () => {
    const good = modelsFromSdk(SDK_ROWS as never);
    expect(parseLearnedModels(JSON.parse(JSON.stringify(good)))).toEqual(good);
    expect(parseLearnedModels([{ id: 'x' }])).toBeNull();
    expect(parseLearnedModels([])).toBeNull();
    expect(parseLearnedModels(null)).toBeNull();
  });
});

describe('ClaudeCodeAdapter model list', () => {
  it('uses the fallback list until the SDK reports one', () => {
    const adapter = new ClaudeCodeAdapter(memoryStore());
    expect(adapter.getModels()).toEqual(FALLBACK_MODELS);
    expect(adapter.backgroundModel).toBe('claude-haiku-4-5-20251001');
  });

  it('switches to the SDK list, saves it and tells listeners once', () => {
    const store = memoryStore();
    const adapter = new ClaudeCodeAdapter(store);
    const listener = vi.fn();
    adapter.onModelsChanged(listener);

    expect(adapter.learnModels(SDK_ROWS as never)).toBe(true);
    expect(adapter.getModels()).toEqual([
      { id: 'claude-opus-5-5', label: 'Opus 5.5', family: 'Claude', contextWindow: 1_000_000 },
      { id: 'claude-sonnet-5', label: 'Sonnet 5', family: 'Claude', contextWindow: 1_000_000 },
      { id: 'claude-fable-5-1', label: 'Fable 5.1', family: 'Claude', contextWindow: 1_000_000 },
      { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', family: 'Claude', contextWindow: 200_000 },
    ]);
    expect(store.saved).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);

    // The same list again changes nothing.
    expect(adapter.learnModels(SDK_ROWS as never)).toBe(false);
    expect(store.saved).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('starts from the list cached by an earlier run', () => {
    const cached = modelsFromSdk(SDK_ROWS as never);
    const adapter = new ClaudeCodeAdapter(memoryStore(JSON.parse(JSON.stringify(cached))));
    expect(adapter.getModels().map((m) => m.id)).toEqual(cached.map((m) => m.id));
  });

  it('ignores a malformed cache', () => {
    const adapter = new ClaudeCodeAdapter(memoryStore([{ nonsense: true }]));
    expect(adapter.getModels()).toEqual(FALLBACK_MODELS);
  });

  it('keeps the list it has when the SDK reports nothing usable', () => {
    const adapter = new ClaudeCodeAdapter(memoryStore());
    expect(adapter.learnModels([{ value: 'default', resolvedModel: 'claude-sonnet-5', displayName: 'Default', description: '' }] as never)).toBe(false);
    expect(adapter.getModels()).toEqual(FALLBACK_MODELS);
  });

  it("follows the SDK's current Haiku for background tasks", () => {
    const adapter = new ClaudeCodeAdapter(memoryStore());
    adapter.learnModels([...SDK_ROWS.slice(0, 4), { value: 'haiku', resolvedModel: 'claude-haiku-5', displayName: 'Haiku', description: 'Haiku 5 · Fastest' }] as never);
    expect(adapter.backgroundModel).toBe('claude-haiku-5');
  });
});

describe('ClaudeCodeAdapter controls from the SDK list', () => {
  const adapter = new ClaudeCodeAdapter(memoryStore());
  adapter.learnModels(SDK_ROWS as never);
  const control = (model: string, id: string) => adapter.getControls(model).find((d) => d.id === id);

  it('offers every effort level the SDK reports for a model the static table lacks', () => {
    const effort = control('claude-sonnet-5', CONTROL_IDS.effort)!;
    expect(effort.options.map((o) => o.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effort.default).toBe('high');
  });

  it("keeps the model's own default effort from the static table", () => {
    expect(control('claude-opus-5-5', CONTROL_IDS.effort)!.default).toBe('medium');
  });

  it('offers fast mode and auto mode only where the SDK says so', () => {
    expect(control('claude-opus-5-5', CONTROL_IDS.speed)).toBeDefined();
    expect(control('claude-sonnet-5', CONTROL_IDS.speed)).toBeUndefined();
    const haikuModes = control('claude-haiku-4-5-20251001', CONTROL_IDS.permissionMode)!.options.map((o) => o.value);
    expect(haikuModes).not.toContain('auto');
  });

  it('gives Haiku no effort control and fixed thinking levels', () => {
    expect(control('claude-haiku-4-5-20251001', CONTROL_IDS.effort)).toBeUndefined();
    expect(control('claude-haiku-4-5-20251001', CONTROL_IDS.thinking)!.options.map((o) => o.value)).toEqual(['off', 'low', 'medium', 'high']);
  });

  it('matches a dated model id to its SDK row', () => {
    expect(control('claude-opus-5-5-20260901', CONTROL_IDS.speed)).toBeDefined();
  });
});
