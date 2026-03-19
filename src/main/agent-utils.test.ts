import { describe, it, expect } from 'vitest';
import { cleanEnv, matchToolRule, readableStreamToAsyncIterable } from './agent-utils.js';

describe('cleanEnv()', () => {
  it('strips npm_ prefixed vars', () => {
    const result = cleanEnv({ npm_package_name: 'foo', HOME: '/home/user' });
    expect(result).toEqual({ HOME: '/home/user' });
  });

  it('strips NVM_ prefixed vars', () => {
    const result = cleanEnv({ NVM_DIR: '/nvm', PATH: '/usr/bin' });
    expect(result).toEqual({ PATH: '/usr/bin' });
  });

  it('strips FNM_ prefixed vars', () => {
    const result = cleanEnv({ FNM_DIR: '/fnm', SHELL: '/bin/bash' });
    expect(result).toEqual({ SHELL: '/bin/bash' });
  });

  it('strips VSCODE_ prefixed vars', () => {
    const result = cleanEnv({ VSCODE_PID: '1234', TERM: 'xterm' });
    expect(result).toEqual({ TERM: 'xterm' });
  });

  it('strips ELECTRON_ prefixed vars', () => {
    const result = cleanEnv({ ELECTRON_RUN_AS_NODE: '1', USER: 'test' });
    expect(result).toEqual({ USER: 'test' });
  });

  it('strips multiple noise prefixes at once', () => {
    const result = cleanEnv({
      npm_config_registry: 'https://registry.npmjs.org',
      NVM_BIN: '/nvm/bin',
      VSCODE_GIT_IPC_HANDLE: '/tmp/vscode',
      ELECTRON_NO_ASAR: '1',
      HOME: '/home/user',
      PATH: '/usr/bin',
    });
    expect(result).toEqual({ HOME: '/home/user', PATH: '/usr/bin' });
  });

  it('returns empty object for all-noise input', () => {
    const result = cleanEnv({ npm_a: '1', NVM_b: '2' });
    expect(result).toEqual({});
  });

  it('preserves all vars when no noise present', () => {
    const env = { HOME: '/home', PATH: '/usr/bin', LANG: 'en_US.UTF-8' };
    expect(cleanEnv(env)).toEqual(env);
  });
});

describe('matchToolRule()', () => {
  describe('simple tool name match (no parentheses)', () => {
    it('matches exact tool name', () => {
      expect(matchToolRule('Bash', 'Bash', 'Bash')).toBe(true);
    });

    it('matches tool name as prefix', () => {
      expect(matchToolRule('Bash', 'BashTool', 'BashTool')).toBe(true);
    });

    it('does not match different tool', () => {
      expect(matchToolRule('Bash', 'Read', 'Read')).toBe(false);
    });

    it('matches mcp__ prefix patterns', () => {
      expect(matchToolRule('mcp__', 'mcp__github', 'mcp__github')).toBe(true);
    });
  });

  describe('pattern with specifier', () => {
    it('matches wildcard * specifier', () => {
      expect(matchToolRule('Bash(*)', 'Bash', 'Bash(npm run dev)')).toBe(true);
    });

    it('matches glob pattern with *', () => {
      expect(matchToolRule('Bash(npm run *)', 'Bash', 'Bash(npm run dev)')).toBe(true);
    });

    it('matches glob pattern with * at start', () => {
      expect(matchToolRule('Bash(* --watch)', 'Bash', 'Bash(vitest --watch)')).toBe(true);
    });

    it('does not match when specifier differs', () => {
      expect(matchToolRule('Bash(npm run *)', 'Bash', 'Bash(yarn dev)')).toBe(false);
    });

    it('does not match when tool name differs', () => {
      expect(matchToolRule('Bash(npm run *)', 'Read', 'Read(/src/foo.ts)')).toBe(false);
    });

    it('matches Read with path pattern', () => {
      expect(matchToolRule('Read(/src/*)', 'Read', 'Read(/src/index.ts)')).toBe(true);
    });

    it('does not match Read path outside pattern', () => {
      expect(matchToolRule('Read(/src/*)', 'Read', 'Read(/lib/foo.ts)')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for malformed pattern (no closing paren)', () => {
      expect(matchToolRule('Bash(npm run', 'Bash', 'Bash(npm run dev)')).toBe(false);
    });

    it('handles empty tool call gracefully', () => {
      expect(matchToolRule('Bash(npm *)', 'Bash', 'Bash')).toBe(false);
    });
  });
});

describe('readableStreamToAsyncIterable()', () => {
  it('iterates all values from the stream', async () => {
    const stream = new ReadableStream<number>({
      start(controller) {
        controller.enqueue(1);
        controller.enqueue(2);
        controller.enqueue(3);
        controller.close();
      },
    });

    const values: number[] = [];
    for await (const value of readableStreamToAsyncIterable(stream)) {
      values.push(value);
    }
    expect(values).toEqual([1, 2, 3]);
  });

  it('handles empty stream', async () => {
    const stream = new ReadableStream<number>({
      start(controller) {
        controller.close();
      },
    });

    const values: number[] = [];
    for await (const value of readableStreamToAsyncIterable(stream)) {
      values.push(value);
    }
    expect(values).toEqual([]);
  });
});
