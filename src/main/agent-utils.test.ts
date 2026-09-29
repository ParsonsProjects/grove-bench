import { describe, it, expect } from 'vitest';
import { cleanEnv, matchToolRule, parseToolRule, toolCallSpecifier, splitShellCommand, checkToolRules, readableStreamToAsyncIterable, findRewindForkPoint } from './agent-utils.js';
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

describe('splitShellCommand()', () => {
  it('splits on every separator Claude Code recognizes', () => {
    expect(splitShellCommand('a && b || c; d | e |& f & g\nh')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('keeps quoted and escaped operators inside their command', () => {
    expect(splitShellCommand(`git commit -m "fix: a; b && c" && echo 'x|y'`))
      .toEqual(['git commit -m "fix: a; b && c"', "echo 'x|y'"]);
    expect(splitShellCommand('git commit -m "feat(parser): x"')).toEqual(['git commit -m "feat(parser): x"']);
    expect(splitShellCommand('echo a \\; b')).toEqual(['echo a \\; b']);
    expect(splitShellCommand("echo $'it\\'s; fine' && ls")).toEqual(["echo $'it\\'s; fine'", 'ls']);
  });

  it('does not treat redirects as separators', () => {
    expect(splitShellCommand('npm test 2>&1 | tee out.txt')).toEqual(['npm test 2>&1', 'tee out.txt']);
    expect(splitShellCommand('npm test &> log.txt')).toEqual(['npm test &> log.txt']);
    expect(splitShellCommand('echo a >| f && echo b >&2')).toEqual(['echo a >| f', 'echo b >&2']);
    expect(splitShellCommand("grep x <<< 'y'")).toEqual(["grep x <<< 'y'"]);
  });

  it('accepts a trailing ; or & and a line break after &&', () => {
    expect(splitShellCommand('npm test;')).toEqual(['npm test']);
    expect(splitShellCommand('npm run dev &')).toEqual(['npm run dev']);
    expect(splitShellCommand('npm test &&\nnpm run lint')).toEqual(['npm test', 'npm run lint']);
  });

  it('returns null for anything it cannot split safely', () => {
    for (const command of [
      'npm run $(echo build)',
      'echo "$(rm -rf ~)"',
      'echo `rm -rf ~`',
      'echo ${HOME}',
      '(cd /tmp && rm -rf x)',
      'diff <(ls a) <(ls b)',
      'echo $((1 + 1))',
      'cat <<EOF\nrm -rf ~\nEOF',
      'npm test # comment',
      'echo "unbalanced',
      "echo 'unbalanced",
      'npm test &&',
      'npm test ||',
      'npm test |',
      '&& ls',
      '; ls',
      'npm test && && ls',
      '',
      '   ',
    ]) {
      expect(splitShellCommand(command), command).toBeNull();
    }
  });

  it('reads $$ as one token, like bash, so a following quote is a plain one', () => {
    // bash runs `rm x` here: the ' after $$ is a plain quote closed by the
    // second ', so the newline is a real separator and the last ' is unbalanced.
    expect(splitShellCommand("echo $$'\\'\nrm x\necho '")).toBeNull();
  });
});

describe('checkToolRules()', () => {
  const rules = (...patterns: string[]) => patterns.map((pattern) => ({ pattern }));
  const shell = (allow: string[], deny: string[], command: string) =>
    checkToolRules(rules(...allow), rules(...deny), 'Bash', command, 'bash');

  it('allows a plain command that matches an allow rule', () => {
    expect(shell(['shell(npm run *)'], [], 'npm run build')).toEqual({ behavior: 'allow' });
    expect(shell(['Bash(npm run *)'], [], 'npm run build')).toEqual({ behavior: 'allow' });
  });

  it('does not allow a chain when a later command matches no allow rule', () => {
    expect(shell(['shell(npm run *)'], [], 'npm run build && rm -rf ~')).toBeNull();
    expect(shell(['Bash(npm run *)'], [], 'npm run build; rm -rf ~')).toBeNull();
    expect(shell(['shell(npm run *)'], [], 'npm run build | sh')).toBeNull();
    expect(shell(['shell(npm run *)'], [], 'npm run build\nrm -rf ~')).toBeNull();
  });

  it('allows a chain when every command matches some allow rule', () => {
    expect(shell(['shell(npm run *)'], [], 'npm run lint && npm run test')).toEqual({ behavior: 'allow' });
    expect(shell(['shell(npm run *)', 'shell(git status)'], [], 'git status && npm run build'))
      .toEqual({ behavior: 'allow' });
  });

  it('denies when a deny rule matches any command in the chain', () => {
    expect(shell(['shell(npm run *)'], ['shell(rm *)'], 'npm run build && rm -rf ~'))
      .toEqual({ behavior: 'deny', pattern: 'shell(rm *)' });
    expect(shell(['shell'], ['shell(git push *)'], 'git add . && git commit -m x && git push origin main'))
      .toEqual({ behavior: 'deny', pattern: 'shell(git push *)' });
  });

  it('does not allow command substitution and other unsplittable commands', () => {
    expect(shell(['shell(npm run *)'], [], 'npm run $(echo build)')).toBeNull();
    expect(shell(['shell(echo *)'], [], 'echo "$(rm -rf ~)"')).toBeNull();
    expect(shell(['shell(echo *)'], [], 'echo `rm -rf ~`')).toBeNull();
    expect(shell(['shell(npm *)'], [], 'npm test &&')).toBeNull();
  });

  it('still denies an unsplittable command that a deny rule matches as a whole', () => {
    expect(shell(['shell'], ['shell(rm *)'], 'rm -rf $(pwd)')).toEqual({ behavior: 'deny', pattern: 'shell(rm *)' });
  });

  it('lets a rule for every shell command approve an unsplittable one, unless a deny rule could apply', () => {
    const commit = 'git commit -m "$(cat msg.txt)"';
    expect(shell(['shell'], [], commit)).toEqual({ behavior: 'allow' });
    expect(shell(['shell(*)'], [], commit)).toEqual({ behavior: 'allow' });
    // We can't see which commands run, so a deny rule might apply: prompt.
    expect(shell(['shell'], ['shell(rm *)'], 'echo $(rm -rf ~)')).toBeNull();
    // A deny rule for another tool doesn't count.
    expect(shell(['shell'], ['edit(.env)'], commit)).toEqual({ behavior: 'allow' });
  });

  it('leaves non-shell rules matching the whole specifier', () => {
    expect(checkToolRules(rules('edit(src/**)'), [], 'Write', 'src/a && b.ts', 'edit')).toEqual({ behavior: 'allow' });
    expect(checkToolRules(rules('web(*github.com*)'), [], 'WebFetch', 'https://github.com/a;b', 'web_fetch'))
      .toEqual({ behavior: 'allow' });
    expect(checkToolRules(rules('mcp(github__*)'), [], 'mcp__github__create_issue', '', 'other'))
      .toEqual({ behavior: 'allow' });
    expect(checkToolRules(rules('edit'), rules('edit(**/.env)'), 'Write', 'app/.env', 'edit'))
      .toEqual({ behavior: 'deny', pattern: 'edit(**/.env)' });
    expect(checkToolRules(rules('edit(src/**)'), [], 'Write', 'docs/a.md', 'edit')).toBeNull();
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
