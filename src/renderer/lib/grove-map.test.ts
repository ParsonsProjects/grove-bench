import { describe, it, expect } from 'vitest';
import { layoutGroveMap, roomHeight, MAP_SCALE, type MapProject, type MapThread } from './grove-map.js';
import { MAP_ART, desks, fence } from './grove-map-art.js';
import type { AgentSpriteState } from './agent-sprite.js';

const thread = (id: string, state: AgentSpriteState = 'ready', helpers = 0): MapThread => ({ id, name: `Thread ${id}`, state, helpers });
const project = (repo: string, n: number, color: string | null = '#61afef'): MapProject => ({
  repo, name: repo.slice(1), color, threads: Array.from({ length: n }, (_, i) => thread(`${repo}-${i}`)),
});

describe('roomHeight', () => {
  it('grows by a cluster of four desks, the last with a front row only past two', () => {
    expect(roomHeight(1)).toBe(roomHeight(2));
    expect(roomHeight(3)).toBe(roomHeight(4));
    expect(roomHeight(3)).toBeGreaterThan(roomHeight(2));
    expect(roomHeight(5)).toBeGreaterThan(roomHeight(4));
    expect(roomHeight(8)).toBeGreaterThan(roomHeight(6));
  });
});

describe('layoutGroveMap', () => {
  it('gives every open thread one seat, inside its project room', () => {
    const projects = [project('/a', 4), project('/b', 2), project('/c', 7), project('/d', 1)];
    const map = layoutGroveMap(projects);
    expect(map.rooms.map((r) => r.repo)).toEqual(['/a', '/b', '/c', '/d']);
    const ids = projects.flatMap((p) => p.threads.map((t) => t.id));
    expect(map.seats.map((s) => s.id).sort()).toEqual([...ids].sort());
    for (const p of projects) {
      const room = map.rooms.find((r) => r.repo === p.repo)!;
      for (const t of p.threads) {
        const seat = map.seats.find((s) => s.id === t.id)!;
        expect(seat.x, t.id).toBeGreaterThanOrEqual(room.x);
        expect(seat.x + seat.w, t.id).toBeLessThanOrEqual(room.x + room.w);
        expect(seat.y + seat.h, t.id).toBeLessThanOrEqual(room.y + room.h);
      }
    }
  });

  it('never lets two rooms, or two seats, overlap', () => {
    const map = layoutGroveMap([project('/a', 9), project('/b', 3), project('/c', 2), project('/d', 5), project('/e', 1)]);
    const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const [i, a] of map.rooms.entries()) for (const b of map.rooms.slice(i + 1)) expect(overlap(a, b), `${a.repo} ${b.repo}`).toBe(false);
    for (const [i, a] of map.seats.entries()) for (const b of map.seats.slice(i + 1)) expect(overlap(a, b), `${a.id} ${b.id}`).toBe(false);
  });

  it('seats the back row facing you, then the front row facing away, four to a cluster', () => {
    const map = layoutGroveMap([project('/a', 6)]);
    expect(map.seats.map((s) => s.facing)).toEqual(['front', 'front', 'back', 'back', 'front', 'front']);
    // The desk covers the back row's legs; the front row shows whole, with its screen.
    for (const s of map.seats) {
      expect(s.cropRows === null, s.id).toBe(s.facing === 'back');
      expect(s.screen === null, s.id).toBe(s.facing === 'front');
    }
  });

  it('puts a banner on threads that need you or failed, and none on the rest', () => {
    const map = layoutGroveMap([{ repo: '/a', name: 'a', color: null, threads: [thread('w', 'working'), thread('p', 'permission'), thread('q', 'asking'), thread('e', 'error')] }]);
    expect(Object.fromEntries(map.seats.map((s) => [s.id, s.callout]))).toEqual({ w: null, p: 'attention', q: 'attention', e: 'error' });
  });

  it('sits up to two subagents by a desk with nobody facing it', () => {
    const lonely = layoutGroveMap([{ repo: '/a', name: 'a', color: null, threads: [thread('x', 'working', 3), thread('y', 'working', 1)] }]);
    expect(lonely.helpers.map((h) => h.key)).toEqual(['x:0', 'x:1', 'y:0']);
    // A full cluster has someone facing every desk: no room for them.
    const full = layoutGroveMap([{ repo: '/a', name: 'a', color: null, threads: ['1', '2', '3', '4'].map((id) => thread(id, 'working', 2)) }]);
    expect(full.helpers).toEqual([]);
  });

  it('stacks rooms in the shorter column', () => {
    const map = layoutGroveMap([project('/a', 12), project('/b', 1), project('/c', 1), project('/d', 1)]);
    const [a, b, c, d] = map.rooms;
    expect(b.x).toBeGreaterThan(a.x);
    expect(c.x).toBe(b.x);
    expect(c.y).toBeGreaterThan(b.y);
    // /a is tall, so /d still goes under /b and /c.
    expect(d.x).toBe(b.x);
  });

  it('leaves out projects with no open threads, and copes with none at all', () => {
    expect(layoutGroveMap([project('/a', 0), project('/b', 1)]).rooms.map((r) => r.repo)).toEqual(['/b']);
    const empty = layoutGroveMap([]);
    expect(empty.rooms).toEqual([]);
    expect(empty.seats).toEqual([]);
    expect(empty.height).toBeGreaterThan(0);
  });

  it('keeps the scenery on the map, in whole art units, and is the same every time', () => {
    const projects = [project('/a', 3), project('/b', 5, null)];
    const map = layoutGroveMap(projects);
    expect(map.width).toBe(map.cols * MAP_SCALE);
    expect(map.height).toBe(map.rows * MAP_SCALE);
    for (const p of map.scenery) {
      for (const v of [p.x, p.y, p.w, p.h]) expect(Number.isInteger(v), JSON.stringify(p)).toBe(true);
      expect(p.w).toBeGreaterThan(0);
      expect(p.h).toBeGreaterThan(0);
    }
    expect(layoutGroveMap(projects)).toEqual(map);
  });

  it('lights the rooms and the paths, and lets fireflies out over the grass only', () => {
    const map = layoutGroveMap([project('/a', 2), project('/b', 2)]);
    // A lantern per room, and lamp posts outside.
    expect(map.glows.length).toBeGreaterThan(map.rooms.length);
    for (const f of map.flies) {
      const inRoom = map.rooms.some((r) => f.x >= r.x && f.x < r.x + r.w && f.y >= r.y && f.y < r.y + r.h);
      expect(inRoom, JSON.stringify(f)).toBe(false);
    }
  });
});

describe('grove map art', () => {
  const maps = { ...MAP_ART, DESKS_1: desks(1, false), DESKS_2: desks(2, true), FENCE: fence(13) };

  it('has rows of one width, drawn only in its own colours', () => {
    for (const [name, a] of Object.entries(maps)) {
      const w = a.rows[0].length;
      for (const row of a.rows) {
        expect(row, name).toHaveLength(w);
        for (const key of row) if (key !== '.') expect(a.pal, `${name}: ${key}`).toHaveProperty(key);
      }
    }
  });

  it('sizes the desks a seat wide each', () => {
    expect(desks(1, false).rows[0]).toHaveLength(22);
    expect(desks(2, true).rows[0]).toHaveLength(44);
    expect(desks(2, true).rows.length).toBeGreaterThan(desks(2, false).rows.length);
  });
});
