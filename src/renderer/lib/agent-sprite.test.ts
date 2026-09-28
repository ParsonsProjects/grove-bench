import { describe, it, expect } from 'vitest';
import { agentSpriteState, agentLook, agentColors, toRuns, AGENT_SPRITES, SPRITE_MAPS, SPRITE_W, SPRITE_H, SIDE_WALK_MAPS, SIDE_WALK_W, SIDE_WALK_H, SKIN_TONES, HAIR_TONES, type AgentSpriteInput } from './agent-sprite.js';

const base: AgentSpriteInput = { destroying: false, status: 'running', hasPending: false, isRunning: false, needsAttention: false };

describe('agentSpriteState', () => {
  it('follows the status dot precedence', () => {
    expect(agentSpriteState({ ...base, destroying: true, status: 'error', hasPending: true })).toBe('removing');
    expect(agentSpriteState({ ...base, status: 'error', hasPending: true })).toBe('error');
    expect(agentSpriteState({ ...base, status: 'starting', isRunning: true })).toBe('starting');
    expect(agentSpriteState({ ...base, status: 'installing' })).toBe('installing');
    expect(agentSpriteState({ ...base, hasPending: true, isRunning: true })).toBe('permission');
    expect(agentSpriteState({ ...base, isRunning: true, needsAttention: true })).toBe('working');
    expect(agentSpriteState({ ...base, status: 'stopped', needsAttention: true })).toBe('unread');
    expect(agentSpriteState({ ...base, status: 'stopped' })).toBe('stopped');
    expect(agentSpriteState({ ...base, status: 'sleeping' })).toBe('sleeping');
    expect(agentSpriteState({ ...base, status: 'sleeping', needsAttention: true })).toBe('unread');
    expect(agentSpriteState(base)).toBe('ready');
  });
});

describe('sprite maps', () => {
  it('are all the same size', () => {
    for (const [name, map] of Object.entries(SPRITE_MAPS)) {
      expect(map, name).toHaveLength(SPRITE_H);
      for (const row of map) expect(row, `${name}: ${row}`).toHaveLength(SPRITE_W);
    }
  });

  it('keep the side-on walk frames the same size', () => {
    expect(SIDE_WALK_MAPS).toHaveLength(2);
    for (const map of SIDE_WALK_MAPS) {
      expect(map).toHaveLength(SIDE_WALK_H);
      for (const row of map) expect(row).toHaveLength(SIDE_WALK_W);
    }
  });

  it('put the project logo on every laptop, open or closed', () => {
    for (const [name, map] of Object.entries(SPRITE_MAPS)) {
      const hasLaptop = !name.startsWith('WALK');
      expect(map.some((row) => row.includes('o')), name).toBe(hasLaptop);
    }
  });

  it('give every state a label, a colour and at least one frame', () => {
    for (const [state, sprite] of Object.entries(AGENT_SPRITES)) {
      expect(sprite.label, state).not.toBe('');
      expect(sprite.colorClass, state).toMatch(/^text-/);
      expect(sprite.frames.length, state).toBeGreaterThanOrEqual(1);
      expect(sprite.frames.length, state).toBeLessThanOrEqual(2);
    }
  });
});

describe('toRuns', () => {
  it('merges same-colour pixels into runs and skips gaps', () => {
    const runs = toRuns(['hh.s......', '..cc..cc..']);
    expect(runs.map(({ x, y, w }) => [x, y, w])).toEqual([
      [0, 0, 2],
      [3, 0, 1],
      [2, 1, 2],
      [6, 1, 2],
    ]);
    // Only state-coloured cells in the symbol columns count as the symbol.
    expect(runs.map((r) => r.symbol)).toEqual([false, false, false, true]);
    expect(runs[2].fill).toBe('currentColor');
    // Runs keep their map key so a look can recolour them.
    expect(runs.map((r) => r.key)).toEqual(['h', 's', 'c', 'c']);
  });
});

describe('agentColors', () => {
  it('adds the project colour to the look as the logo', () => {
    expect(agentColors('3f9a1c07', '#61afef')).toEqual({ ...agentLook('3f9a1c07'), o: '#61afef' });
  });

  it('leaves the logo to the fallback without a project colour', () => {
    expect(agentColors('3f9a1c07', null)).toEqual(agentLook('3f9a1c07'));
    expect(agentColors(undefined)).toEqual({});
  });
});

describe('agentLook', () => {
  it('gives the same seed the same look', () => {
    expect(agentLook('3f9a1c07')).toEqual(agentLook('3f9a1c07'));
  });

  it('pairs a skin tone with its own closed-eye shade and a hair colour', () => {
    const look = agentLook('3f9a1c07');
    expect(SKIN_TONES).toContainEqual({ s: look.s, z: look.z });
    expect(HAIR_TONES).toContain(look.h);
  });

  it('uses every skin tone and hair colour across conversation ids', () => {
    // Ids are the first 8 hex characters of a UUID.
    const ids = Array.from({ length: 300 }, (_, i) => (Math.imul(i + 1, 0x9e3779b1) >>> 0).toString(16).padStart(8, '0'));
    const looks = ids.map(agentLook);
    expect(new Set(looks.map((l) => l.s)).size).toBe(SKIN_TONES.length);
    expect(new Set(looks.map((l) => l.h)).size).toBe(HAIR_TONES.length);
  });
});
