import { describe, it, expect } from 'vitest';
import { boardStage, boardLanes, boardFollowUps, matchesBoardQuery, prSummary, BOARD_STAGES, type LaneSource } from './board.js';
import type { FollowUp } from '../../shared/follow-ups.js';
import { AGENT_SPRITES, type AgentSpriteState } from './agent-sprite.js';

describe('boardStage', () => {
  it('puts a thread that is working, or starting up, in Working whatever its PR', () => {
    for (const state of ['working', 'starting', 'installing'] as const) {
      expect(boardStage(state, null)).toBe('working');
      expect(boardStage(state, { state: 'MERGED' })).toBe('working');
    }
  });

  it('puts one waiting on you, or stopped by an error, in Needs you', () => {
    expect(boardStage('permission', null)).toBe('needs-you');
    expect(boardStage('asking', null)).toBe('needs-you');
    expect(boardStage('error', { state: 'MERGED' })).toBe('needs-you');
  });

  it('puts a quiet thread in Review until its PR is merged or closed', () => {
    for (const state of ['unread', 'ready', 'sleeping', 'stopped'] as const) {
      expect(boardStage(state, null)).toBe('review');
      expect(boardStage(state, { state: 'OPEN' })).toBe('review');
      expect(boardStage(state, { state: 'MERGED' })).toBe('done');
      expect(boardStage(state, { state: 'CLOSED' })).toBe('done');
    }
  });

  it('gives a thread being removed no card', () => {
    expect(boardStage('removing', null)).toBeNull();
  });

  it('places every status the sidebar can show', () => {
    const states = Object.keys(AGENT_SPRITES) as AgentSpriteState[];
    for (const state of states.filter((s) => s !== 'removing')) {
      expect(BOARD_STAGES).toContain(boardStage(state, null));
    }
  });
});

describe('boardLanes', () => {
  const cards = [
    { id: 'a', repoPath: '/web' },
    { id: 'b', repoPath: '/api' },
    { id: 'c', repoPath: '/web' },
    { id: 'd', repoPath: '/api' },
  ];
  const src: LaneSource = {
    repos: ['/api', '/web', '/infra'],
    repoName: (p) => p.slice(1),
    groups: [
      { id: 'g2', name: 'Billing', sessionIds: ['d', 'a'] },
      { id: 'g1', name: 'Empty here', sessionIds: ['zzz'] },
    ],
  };

  it('keeps every card in one unnamed lane with lanes off', () => {
    expect(boardLanes(cards, 'none', src)).toEqual([{ key: 'all', label: null, repoPaths: [], cards }]);
  });

  it('makes a lane per project in the sidebar order, leaving out projects with no card', () => {
    const lanes = boardLanes(cards, 'project', src);
    expect(lanes.map((l) => l.label)).toEqual(['api', 'web']);
    expect(lanes[0].cards.map((c) => c.id)).toEqual(['b', 'd']);
    expect(lanes[1].repoPaths).toEqual(['/web']);
  });

  it('puts a project the sidebar does not list after the rest', () => {
    const lanes = boardLanes([...cards, { id: 'e', repoPath: '/new' }], 'project', src);
    expect(lanes.map((l) => l.key)).toEqual(['/api', '/web', '/new']);
  });

  it('makes a lane per group, in the cards\' order, and ends with the threads in no group', () => {
    const lanes = boardLanes(cards, 'group', src);
    expect(lanes.map((l) => l.label)).toEqual(['Billing', 'Not in a group']);
    expect(lanes[0].cards.map((c) => c.id)).toEqual(['a', 'd']);
    expect(lanes[0].repoPaths).toEqual(['/web', '/api']);
    expect(lanes[1].cards.map((c) => c.id)).toEqual(['b', 'c']);
  });

  it('leaves out "Not in a group" when every card is in one', () => {
    const lanes = boardLanes(cards.filter((c) => c.id === 'a'), 'group', src);
    expect(lanes.map((l) => l.key)).toEqual(['g2']);
  });
});

describe('prSummary', () => {
  const checks = (failed: number, pending: number, total = 3) => ({ total, passed: total - failed - pending, failed, pending });

  it('says how a pull request ended before anything else', () => {
    expect(prSummary({ state: 'MERGED', checks: checks(1, 0) })).toEqual({ label: 'Merged', tone: 'accent' });
    expect(prSummary({ state: 'CLOSED', isDraft: true })).toEqual({ label: 'Closed', tone: 'muted' });
  });

  it('then what stops an open one, then how it stands', () => {
    expect(prSummary({ state: 'OPEN', isDraft: true, checks: checks(1, 0) }).label).toBe('Draft');
    expect(prSummary({ state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED', checks: checks(1, 0) }).label).toBe('Changes requested');
    expect(prSummary({ state: 'OPEN', reviewDecision: 'APPROVED', checks: checks(1, 0) }).label).toBe('Checks failing');
    expect(prSummary({ state: 'OPEN', reviewDecision: 'APPROVED', checks: checks(0, 1) }).label).toBe('Approved');
    expect(prSummary({ state: 'OPEN', checks: checks(0, 1) }).label).toBe('Checks running');
    expect(prSummary({ state: 'OPEN', checks: checks(0, 0) }).label).toBe('Checks passing');
    expect(prSummary({ state: 'OPEN', checks: null })).toEqual({ label: 'Open', tone: 'neutral' });
    expect(prSummary({ state: 'OPEN', checks: checks(0, 0, 0) }).label).toBe('Open');
  });
});

describe('matchesBoardQuery', () => {
  const fields = ['Fix flaky test', 'grove-bench', 'fix/remove-tree-flake', null];

  it('matches everything with an empty query', () => {
    expect(matchesBoardQuery('', fields)).toBe(true);
    expect(matchesBoardQuery('   ', fields)).toBe(true);
  });

  it('needs every word somewhere, ignoring case', () => {
    expect(matchesBoardQuery('FLAKY grove', fields)).toBe(true);
    expect(matchesBoardQuery('remove-tree', fields)).toBe(true);
    expect(matchesBoardQuery('flaky landing', fields)).toBe(false);
  });
});

describe('boardFollowUps', () => {
  const f = (id: string, extra: Partial<FollowUp> = {}): FollowUp => ({ id, repoPath: '/web', title: id, details: '', createdAt: 0, ...extra });
  const open = new Set(['running-thread']);

  it('keeps open follow-ups in known projects, oldest first', () => {
    const list = [f('a'), f('b', { doneAt: 1 }), f('c', { repoPath: '/removed' }), f('d')];
    expect(boardFollowUps(list, ['/web'], (id) => open.has(id)).map((x) => x.followUp.id)).toEqual(['a', 'd']);
  });

  it('leaves out one whose thread is open, and brings back one whose thread closed', () => {
    const list = [f('a', { startedSessionIds: ['running-thread'] }), f('b', { startedSessionIds: ['closed-thread'] })];
    expect(boardFollowUps(list, ['/web'], (id) => open.has(id))).toEqual([{ followUp: list[1], startedBefore: true }]);
  });
});
