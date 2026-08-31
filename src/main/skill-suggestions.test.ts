import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { AgentEvent, SkillInfo } from '../shared/types.js';
import {
  normalizeCommand,
  extractActivity,
  tokenize,
  jaccard,
  clusterPrompts,
  findPatterns,
  suggestionFromPattern,
  suggestionId,
  filterCovered,
  parseDistilled,
  distillSuggestions,
  analyzeRepo,
  getCachedSuggestions,
  dismissSuggestion,
} from './skill-suggestions.js';

function userMsg(text: string): AgentEvent {
  return { type: 'user_message', text } as AgentEvent;
}

function bash(command: string): AgentEvent {
  return { type: 'assistant_tool_use', toolName: 'Bash', toolInput: { command }, toolUseId: 't', uuid: 'u' } as AgentEvent;
}

describe('normalizeCommand', () => {
  it('takes the first line, collapses whitespace, caps length', () => {
    expect(normalizeCommand('npm  run   dist\nrm -rf dist')).toBe('npm run dist');
    expect(normalizeCommand('x'.repeat(300)).length).toBe(160);
  });
});

describe('extractActivity', () => {
  it('collects user prompts and Bash commands, filtering noise', () => {
    const activity = extractActivity('s1', [
      userMsg('Update the changelog since the last tag'),
      userMsg('[System] Context was just compacted.'),
      bash('npm run dist && installer.exe'),
      bash('git status'), // stoplisted
      bash('ls -la'),     // stoplisted
      { type: 'assistant_text', text: 'ok', uuid: 'u' } as AgentEvent,
    ]);
    expect(activity.prompts).toEqual(['Update the changelog since the last tag']);
    expect(activity.bashCommands).toEqual(['npm run dist && installer.exe']);
  });
});

describe('tokenize / jaccard', () => {
  it('drops stopwords and short tokens', () => {
    const tokens = tokenize('Please can you update the changelog for release');
    expect(tokens.has('please')).toBe(false);
    expect(tokens.has('changelog')).toBe(true);
  });

  it('jaccard is 1 for identical sets and 0 for disjoint', () => {
    const a = tokenize('update changelog release');
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, tokenize('fix flaky checkout spec'))).toBe(0);
  });
});

describe('clusterPrompts', () => {
  it('groups similar prompts and counts distinct sessions', () => {
    const clusters = clusterPrompts([
      { sessionId: 's1', text: 'Update the changelog with merged PRs since the last tag' },
      { sessionId: 's2', text: 'Update changelog with the PRs merged since last tag please' },
      { sessionId: 's2', text: 'Update the changelog with merged PRs since the tag' },
      { sessionId: 's3', text: 'Fix the flaky checkout e2e spec on CI' },
    ]);
    expect(clusters).toHaveLength(2);
    const changelog = clusters.find((c) => c.label.includes('changelog'))!;
    expect(changelog.samples).toHaveLength(3);
    expect(changelog.sessionCount).toBe(2);
  });

  it('skips prompts too short to identify a workflow', () => {
    expect(clusterPrompts([{ sessionId: 's1', text: 'fix it' }])).toHaveLength(0);
  });
});

describe('findPatterns', () => {
  const activity = (sessionId: string, prompts: string[], bashCommands: string[] = []) =>
    ({ sessionId, prompts, bashCommands });

  it('emits prompt patterns only at the session threshold', () => {
    const prompt = 'Update the changelog with merged PRs since the last tag';
    const two = [activity('s1', [prompt]), activity('s2', [prompt])];
    expect(findPatterns(two, 3)).toHaveLength(0);
    const three = [...two, activity('s3', [prompt])];
    const patterns = findPatterns(three, 3);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({ kind: 'prompt', sessionCount: 3, occurrences: 3 });
  });

  it('emits command patterns across sessions with total occurrences', () => {
    const cmd = 'npm run dist && installer.exe';
    const activities = [
      activity('s1', [], [cmd, cmd]),
      activity('s2', [], [cmd]),
      activity('s3', [], [cmd]),
    ];
    const patterns = findPatterns(activities, 3);
    expect(patterns).toEqual([
      expect.objectContaining({ kind: 'command', label: cmd, sessionCount: 3, occurrences: 4 }),
    ]);
  });
});

describe('suggestionFromPattern', () => {
  it('builds a kebab-case name and stable id', () => {
    const suggestion = suggestionFromPattern({
      kind: 'prompt',
      label: 'Update the changelog with merged PRs',
      sessionCount: 4,
      occurrences: 6,
      examples: ['Update the changelog with merged PRs'],
    });
    expect(suggestion.name).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(suggestion.id).toBe(suggestionId('Update the changelog with merged PRs'));
    expect(suggestion.rationale).toContain('4 sessions');
  });
});

describe('filterCovered', () => {
  const existing: SkillInfo[] = [
    { name: 'changelog-update', description: 'Update the changelog from merged PRs', source: 'project' },
  ];

  it('drops suggestions matching an existing name or overlapping description', () => {
    const covered = suggestionFromPattern({
      kind: 'prompt', label: 'update the changelog from merged PRs', sessionCount: 3, occurrences: 3, examples: [],
    });
    expect(filterCovered([covered], existing)).toHaveLength(0);
  });

  it('keeps unrelated suggestions', () => {
    const unrelated = suggestionFromPattern({
      kind: 'command', label: 'npm run dist && installer.exe', sessionCount: 3, occurrences: 3, examples: [],
    });
    expect(filterCovered([unrelated], existing)).toHaveLength(1);
  });
});

describe('parseDistilled', () => {
  it('extracts a fenced JSON array and validates it', () => {
    const reply = 'Here you go:\n```json\n[{"patternIndex":0,"name":"changelog-update","description":"d","instructions":"i","rationale":"r"}]\n```';
    expect(parseDistilled(reply)).toHaveLength(1);
  });

  it('rejects invalid names and malformed replies', () => {
    expect(parseDistilled('[{"patternIndex":0,"name":"Bad Name","description":"d","instructions":"i","rationale":"r"}]')).toBeNull();
    expect(parseDistilled('no json here')).toBeNull();
  });
});

describe('distillSuggestions', () => {
  it('maps model output back to pattern evidence and drops bad indices', async () => {
    const candidates = [
      { kind: 'command' as const, label: 'npm run dist', sessionCount: 3, occurrences: 5, examples: ['npm run dist'] },
    ];
    const generateText = vi.fn().mockResolvedValue(JSON.stringify([
      { patternIndex: 0, name: 'dist-build', description: 'd', instructions: 'i', rationale: 'r' },
      { patternIndex: 7, name: 'ghost', description: 'd', instructions: 'i', rationale: 'r' },
    ]));
    const result = await distillSuggestions(generateText, candidates);
    expect(result).toHaveLength(1);
    expect(result![0]).toMatchObject({
      name: 'dist-build',
      id: suggestionId('npm run dist'),
      evidence: ['npm run dist'],
      sessionCount: 3,
    });
  });
});

describe('analyzeRepo (integration)', () => {
  let eventsDir: string;
  let stateDir: string;
  const repoPath = 'C:/repo';

  beforeEach(() => {
    eventsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-events-'));
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-state-'));
    vi.mocked(app.getPath).mockReturnValue(stateDir);
  });

  afterEach(() => {
    fs.rmSync(eventsDir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  function writeLog(sessionId: string, events: AgentEvent[]) {
    fs.writeFileSync(
      path.join(eventsDir, `${sessionId}.jsonl`),
      events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    );
  }

  it('mines logs, caches suggestions, and honors dismissals across runs', async () => {
    const prompt = 'Update the changelog with merged PRs since the last tag';
    for (const id of ['s1', 's2', 's3']) writeLog(id, [userMsg(prompt)]);

    const opts = { repoPath, sessionIds: ['s1', 's2', 's3'], eventsDir, existingSkills: [] };
    const suggestions = await analyzeRepo(opts);
    expect(suggestions).toHaveLength(1);
    expect(getCachedSuggestions(repoPath)).toEqual(suggestions);

    dismissSuggestion(repoPath, suggestions[0].id);
    expect(getCachedSuggestions(repoPath)).toHaveLength(0);

    // Re-analysis must not resurrect a dismissed suggestion
    expect(await analyzeRepo(opts)).toHaveLength(0);
  });

  it('prefers distilled drafts and falls back to heuristics on garbage output', async () => {
    const prompt = 'Update the changelog with merged PRs since the last tag';
    for (const id of ['s1', 's2', 's3']) writeLog(id, [userMsg(prompt)]);
    const opts = { repoPath, sessionIds: ['s1', 's2', 's3'], eventsDir, existingSkills: [] };

    const distilled = await analyzeRepo({
      ...opts,
      generateText: async () => JSON.stringify([
        { patternIndex: 0, name: 'changelog-refresh', description: 'polished', instructions: 'i', rationale: 'r' },
      ]),
    });
    expect(distilled[0].name).toBe('changelog-refresh');

    const fallback = await analyzeRepo({ ...opts, generateText: async () => 'not json at all' });
    expect(fallback).toHaveLength(1); // heuristic draft survives
  });

  it('makes no model call when the heuristics find nothing', async () => {
    writeLog('s1', [userMsg('One-off request that never recurs anywhere')]);
    const generateText = vi.fn();
    const result = await analyzeRepo({
      repoPath, sessionIds: ['s1'], eventsDir, existingSkills: [], generateText,
    });
    expect(result).toHaveLength(0);
    expect(generateText).not.toHaveBeenCalled();
  });
});
