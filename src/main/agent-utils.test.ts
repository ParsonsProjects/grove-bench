import { describe, it, expect } from 'vitest';
import { cleanEnv, matchToolRule, parseToolRule, toolCallSpecifier, readableStreamToAsyncIterable, findRewindForkPoint } from './agent-utils.js';
import type { AgentEvent } from '../shared/types.js';

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

describe('matchToolRule() neutral keywords', () => {
  it('matches a shell rule against any bash-category tool regardless of provider name', () => {
    expect(matchToolRule('shell(npm run *)', 'Bash', 'Bash(npm run dev)', 'bash')).toBe(true);
    expect(matchToolRule('shell(npm run *)', 'run_command', 'run_command(npm run dev)', 'bash')).toBe(true);
    expect(matchToolRule('shell(npm run *)', 'Bash', 'Bash(yarn dev)', 'bash')).toBe(false);
    expect(matchToolRule('shell', 'Bash', 'Bash(rm -rf /)', 'bash')).toBe(true);
    // Keywords are case-insensitive
    expect(matchToolRule('Shell(git push *)', 'Bash', 'Bash(git push origin)', 'bash')).toBe(true);
  });

  it('matches edit/read rules on the file path', () => {
    expect(matchToolRule('edit(src/**)', 'Write', 'Write(src/a.ts)', 'edit')).toBe(true);
    expect(matchToolRule('edit(src/**)', 'Write', 'Write(docs/a.md)', 'edit')).toBe(false);
    expect(matchToolRule('read(**/.env*)', 'Read', 'Read(/repo/.env.local)', 'read')).toBe(true);
    // A read rule never matches an edit tool
    expect(matchToolRule('read(**)', 'Write', 'Write(src/a.ts)', 'edit')).toBe(false);
  });

  it('matches web, agent and question keywords by category', () => {
    expect(matchToolRule('web(*github.com*)', 'WebFetch', 'WebFetch(https://github.com/x)', 'web_fetch')).toBe(true);
    expect(matchToolRule('web(*github.com*)', 'WebFetch', 'WebFetch(https://example.com)', 'web_fetch')).toBe(false);
    expect(matchToolRule('agent', 'Agent', 'Agent(do things)', 'agent')).toBe(true);
    expect(matchToolRule('question', 'AskUserQuestion', 'AskUserQuestion', 'question')).toBe(true);
  });

  it('mcp(...) matches the tool name after the mcp__ prefix', () => {
    expect(matchToolRule('mcp', 'mcp__github__create_issue', 'mcp__github__create_issue', 'other')).toBe(true);
    expect(matchToolRule('mcp(github__*)', 'mcp__github__create_issue', 'mcp__github__create_issue', 'other')).toBe(true);
    expect(matchToolRule('mcp(slack__*)', 'mcp__github__create_issue', 'mcp__github__create_issue', 'other')).toBe(false);
    expect(matchToolRule('mcp', 'Bash', 'Bash(ls)', 'bash')).toBe(false);
  });

  it('does not treat a keyword as a category match without a category, but still allows provider-name matches', () => {
    // No category supplied (legacy 3-arg call): keywords only match by name
    expect(matchToolRule('shell(*)', 'Bash', 'Bash(ls)')).toBe(false);
    expect(matchToolRule('Bash(*)', 'Bash', 'Bash(ls)', 'bash')).toBe(true);
  });

  it('rejects malformed patterns', () => {
    expect(matchToolRule('', 'Bash', 'Bash', 'bash')).toBe(false);
    expect(matchToolRule('Bash(unclosed', 'Bash', 'Bash(x)', 'bash')).toBe(false);
    expect(parseToolRule('Bash(unclosed')).toBeNull();
    expect(parseToolRule(' shell ')).toEqual({ tool: 'shell', specifier: null });
    expect(parseToolRule('edit(src/**)')).toEqual({ tool: 'edit', specifier: 'src/**' });
  });
});

describe('toolCallSpecifier()', () => {
  it('picks the field that the category\'s glob should match', () => {
    expect(toolCallSpecifier('Bash', { command: 'ls' }, 'bash')).toBe('ls');
    expect(toolCallSpecifier('Write', { file_path: 'a.ts' }, 'edit')).toBe('a.ts');
    expect(toolCallSpecifier('NotebookEdit', { notebook_path: 'n.ipynb' }, 'edit')).toBe('n.ipynb');
    expect(toolCallSpecifier('Grep', { pattern: 'TODO' }, 'read')).toBe('TODO');
    expect(toolCallSpecifier('WebFetch', { url: 'https://x' }, 'web_fetch')).toBe('https://x');
    expect(toolCallSpecifier('Agent', { prompt: 'go' }, 'agent')).toBe('go');
    expect(toolCallSpecifier('Mystery', { command: 'c' })).toBe('c');
    expect(toolCallSpecifier('Mystery', { other: 1 }, 'other')).toBe('');
    expect(toolCallSpecifier('Bash', null, 'bash')).toBe('');
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

describe('findRewindForkPoint()', () => {
  const user = (uuid: string, text = 'msg'): AgentEvent => ({ type: 'user_message', text, uuid });
  const assistant = (uuid: string): AgentEvent => ({ type: 'assistant_text', text: 'reply', uuid });
  const toolUse = (uuid: string): AgentEvent => ({
    type: 'assistant_tool_use', toolName: 'Bash', toolInput: {}, toolUseId: 'tu1', uuid,
  });
  const thinking = (uuid: string): AgentEvent => ({ type: 'thinking', thinking: 'hmm', uuid });
  const toolResult = (): AgentEvent => ({ type: 'tool_result', toolUseId: 'tu1', content: 'ok' });

  it('returns the uuid of the last assistant event before the target', () => {
    const events = [
      user('grove-1'), assistant('sdk-1'), assistant('sdk-2'),
      user('grove-2'), assistant('sdk-3'),
    ];
    expect(findRewindForkPoint(events, 'grove-2')).toBe('sdk-2');
  });

  it('counts tool_use and thinking events as fork points', () => {
    const events = [user('grove-1'), thinking('sdk-1'), toolUse('sdk-2'), user('grove-2')];
    expect(findRewindForkPoint(events, 'grove-2')).toBe('sdk-2');
  });

  it('skips events without provider uuids (e.g. tool results)', () => {
    const events = [user('grove-1'), assistant('sdk-1'), toolResult(), user('grove-2')];
    expect(findRewindForkPoint(events, 'grove-2')).toBe('sdk-1');
  });

  it('never uses another user message uuid as a fork point', () => {
    // user_message uuids are Grove-generated, not provider chain uuids
    const events = [user('grove-1'), user('grove-2')];
    expect(findRewindForkPoint(events, 'grove-2')).toBeNull();
  });

  it('returns null when rewinding to the first message', () => {
    const events = [user('grove-1'), assistant('sdk-1')];
    expect(findRewindForkPoint(events, 'grove-1')).toBeNull();
  });

  it('returns null when the target uuid is not in the history', () => {
    const events = [user('grove-1'), assistant('sdk-1')];
    expect(findRewindForkPoint(events, 'missing')).toBeNull();
  });

  it('uses the last occurrence when duplicate uuids exist', () => {
    const events = [
      user('grove-1'), assistant('sdk-1'),
      user('grove-1'), assistant('sdk-2'),
      user('grove-2'),
    ];
    // findLast semantics: the second grove-1 is the anchor
    expect(findRewindForkPoint(events, 'grove-1')).toBe('sdk-1');
  });
});
