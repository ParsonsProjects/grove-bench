import { describe, it, expect } from 'vitest';
import type { SpawnOptions } from 'node:child_process';
import { timeFinds } from './process-host-launch.js';

type Parsed = { command: string; args: string[]; options: SpawnOptions; file?: string };

/** A stand-in for cross-spawn's module, whose parse takes `ms` on `clock`. */
function fakeCrossSpawn(clock: { t: number }, ms: number) {
  const target = {
    _parse(this: unknown, command: string, args: readonly string[], options: SpawnOptions): Parsed {
      if (this !== target) throw new Error('called without its module');
      clock.t += ms;
      if (command === 'boom') throw new Error('bad command');
      return { command, args: [...args], options, file: `/bin/${command}` };
    },
  };
  return target;
}

describe('timeFinds', () => {
  it('times each parse through the module, as execa calls it, and leaves what it returns alone', () => {
    const clock = { t: 0 };
    const target = fakeCrossSpawn(clock, 30);
    const take = timeFinds(target, () => clock.t);
    const parsed = target._parse('git', ['status'], { cwd: '/r' });
    expect(parsed).toEqual({ command: 'git', args: ['status'], options: { cwd: '/r' }, file: '/bin/git' });
    expect(take()).toBe(30);
  });

  it('adds up the parses since it was last asked, then starts again from none', () => {
    const clock = { t: 0 };
    const target = fakeCrossSpawn(clock, 20);
    const take = timeFinds(target, () => clock.t);
    expect(take()).toBeUndefined();
    target._parse('git', [], {});
    target._parse('gh', [], {});
    expect(take()).toBe(40);
    expect(take()).toBeUndefined();
  });

  it('times a parse that throws, and still throws', () => {
    const clock = { t: 0 };
    const target = fakeCrossSpawn(clock, 5);
    const take = timeFinds(target, () => clock.t);
    expect(() => target._parse('boom', [], {})).toThrow('bad command');
    expect(take()).toBe(5);
  });
});
