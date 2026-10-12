import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { accountEnv, accountSignInCommand, claudeAccounts, CLAUDE_ACCOUNT_PREFIX, INHERITED_SIGN_IN_ENV, isClaudeAccountId, newClaudeAccount, removedAccountMessage } from './claude-accounts.js';

const home = path.resolve('/home/me');

describe('claudeAccounts()', () => {
  it('makes an agent id from the name and a folder next to ~/.claude', () => {
    expect(claudeAccounts([{ id: '', name: 'Work', configDir: '' }], home)).toEqual([
      { id: `${CLAUDE_ACCOUNT_PREFIX}work`, name: 'Work', configDir: path.join(home, '.claude-work') },
    ]);
  });

  it('keeps a saved id, so renaming an account keeps its threads', () => {
    const [account] = claudeAccounts([{ id: 'work', name: 'Day job', configDir: '' }], home);
    expect(account.id).toBe('claude-account-work');
    expect(account.name).toBe('Day job');
  });

  it('uses the folder given, with ~ and relative paths taken from the home folder', () => {
    const abs = path.resolve('/data/claude-client');
    expect(claudeAccounts([{ id: '', name: 'A', configDir: abs }], home)[0].configDir).toBe(abs);
    expect(claudeAccounts([{ id: '', name: 'B', configDir: '~/.claude-b' }], home)[0].configDir).toBe(path.join(home, '.claude-b'));
    expect(claudeAccounts([{ id: '', name: 'C', configDir: '.claude-c' }], home)[0].configDir).toBe(path.join(home, '.claude-c'));
  });

  it('gives a name with no usable letters a stable id', () => {
    const first = claudeAccounts([{ id: '', name: '仕事', configDir: '' }], home);
    const again = claudeAccounts([{ id: '', name: '仕事', configDir: '' }], home);
    expect(first[0].id).toMatch(/^claude-account-account-[0-9a-f]{8}$/);
    expect(again[0].id).toBe(first[0].id);
  });

  it('skips entries without a name and ones that repeat an id', () => {
    expect(claudeAccounts([
      { id: '', name: '  ', configDir: '' },
      { id: '', name: 'Work', configDir: '' },
      { id: '', name: 'work', configDir: '/elsewhere' },
    ], home).map((a) => a.id)).toEqual(['claude-account-work']);
  });

  it('can never take the default agent id', () => {
    const [account] = claudeAccounts([{ id: 'code', name: 'Code', configDir: '' }], home);
    expect(account.id).not.toBe('claude-code');
  });
});

describe('accountEnv()', () => {
  it("drops sign-ins Claude Code would use over the folder's own and points at the folder", () => {
    const inherited = Object.fromEntries(INHERITED_SIGN_IN_ENV.map((name) => [name, 'x']));
    const env = accountEnv({ ...inherited, PATH: '/bin', CLAUDE_CONFIG_DIR: '/other' }, '/home/me/.claude-work');
    expect(env).toEqual({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/home/me/.claude-work' });
  });

  it('covers the env credentials and provider switches above /login, and a gateway address', () => {
    for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'ANTHROPIC_BASE_URL']) {
      expect(INHERITED_SIGN_IN_ENV).toContain(name);
    }
  });

  it('matches names in any case, as Windows does', () => {
    expect(accountEnv({ Anthropic_Api_Key: 'sk-shell', claude_config_dir: '/other', Path: 'C:\\bin' }, 'C:\\f'))
      .toEqual({ Path: 'C:\\bin', CLAUDE_CONFIG_DIR: 'C:\\f' });
  });

  it("doesn't change the environment it was given", () => {
    const base = { ANTHROPIC_API_KEY: 'sk-shell' };
    accountEnv(base, '/f');
    expect(base).toEqual({ ANTHROPIC_API_KEY: 'sk-shell' });
  });
});

describe('accountSignInCommand()', () => {
  it("runs Claude Code's own sign-in with the account's folder in a child cmd, so Command Prompt and PowerShell both run it", () => {
    expect(accountSignInCommand('C:\\Users\\alan_\\.claude-work'))
      .toEqual({ command: 'cmd /c "set CLAUDE_CONFIG_DIR=C:\\Users\\alan_\\.claude-work&& claude auth login"' });
  });

  it('keeps spaces, quotes and cmd syntax characters in the folder name as they are', () => {
    expect(accountSignInCommand("C:\\My Files\\o'neil\\.claude-work").command)
      .toBe(`cmd /c "set CLAUDE_CONFIG_DIR=C:\\My Files\\o'neil\\.claude-work&& claude auth login"`);
    expect(accountSignInCommand('D:\\R&D\\a|b<c>^d').command)
      .toBe('cmd /c "set CLAUDE_CONFIG_DIR=D:\\R^&D\\a^|b^<c^>^^d&& claude auth login"');
  });

  it("falls back to a PowerShell line for a folder name one of the shells would change, and says so", () => {
    for (const dir of ['C:\\100%\\x', 'C:\\a$b\\x', 'C:\\a`b\\x', 'C:\\a\u201Cb\\x']) {
      expect(accountSignInCommand(dir).shell).toBe('PowerShell');
    }
    expect(accountSignInCommand("C:\\a$b\\o'neil")).toEqual({
      command: "$env:CLAUDE_CONFIG_DIR = 'C:\\a$b\\o''neil'; claude auth login; Remove-Item Env:CLAUDE_CONFIG_DIR",
      shell: 'PowerShell',
    });
    // PowerShell also ends a single-quoted string at these (CharTraits.IsSingleQuote).
    for (const q of ['\u2018', '\u2019', '\u201A', '\u201B']) {
      expect(accountSignInCommand(`C:\\a$b\\O${q}Neil`).command).toContain(`'C:\\a$b\\O${q}${q}Neil'`);
    }
  });
});

describe('newClaudeAccount()', () => {
  const opts = { home, env: { USERPROFILE: home, DATA: path.resolve('/data') } };

  it('fixes the id from the name, so a later rename keeps the agent and its folder', () => {
    const { account, setting } = newClaudeAccount({ name: ' Work ', configDir: '' }, [], opts);
    expect(account).toEqual({ id: 'claude-account-work', name: 'Work', configDir: path.join(home, '.claude-work') });
    expect(setting).toEqual({ id: 'work', name: 'Work', configDir: '' });
    expect(claudeAccounts([{ ...setting, name: 'Day job' }], home)[0]).toMatchObject({ id: 'claude-account-work', configDir: path.join(home, '.claude-work') });
  });

  it('saves a typed folder as the absolute path it resolves to', () => {
    expect(newClaudeAccount({ name: 'A', configDir: '"%DATA%/claude-a"' }, [], opts).setting.configDir).toBe(path.join(path.resolve('/data'), 'claude-a'));
    expect(newClaudeAccount({ name: 'B', configDir: "'~/.claude-b'" }, [], opts).setting.configDir).toBe(path.join(home, '.claude-b'));
    expect(newClaudeAccount({ name: 'C', configDir: '%userprofile%/c' }, [], opts).setting.configDir).toBe(path.join(home, 'c'));
  });

  it('turns away names and folders that would clash or misplace the sign-in', () => {
    const saved = [{ id: 'work', name: 'Work', configDir: '' }];
    const reason = (name: string, configDir = '') => {
      try { newClaudeAccount({ name, configDir }, saved, opts); return null; } catch (e) { return (e as Error).message; }
    };
    expect(reason('  ')).toMatch(/Enter a name/);
    expect(reason('x'.repeat(41))).toMatch(/40 characters/);
    expect(reason('work!')).toBe('You already have an account called "Work". Pick another name.');
    expect(reason('Other', '~/.claude-work')).toBe('"Work" already uses that folder.');
    expect(reason('Other', '~')).toMatch(/not your home folder/);
    expect(reason('Other', '~/.claude')).toMatch(/your first account's/);
    expect(reason('Other', '%NOPE%/x')).toBe("%NOPE% isn't set on this computer.");
    expect(reason('Other')).toBeNull();
  });

  it("takes the first account's folder from CLAUDE_CONFIG_DIR when that is set", () => {
    const env = { CLAUDE_CONFIG_DIR: path.join(home, 'claude-main') };
    expect(() => newClaudeAccount({ name: 'X', configDir: '~/claude-main' }, [], { home, env })).toThrow(/your first account's/);
  });
});

describe('removed accounts', () => {
  it('knows an account agent by its id and says why its work stays put', () => {
    expect(isClaudeAccountId('claude-account-work')).toBe(true);
    expect(isClaudeAccountId('claude-code')).toBe(false);
    expect(isClaudeAccountId(undefined)).toBe(false);
    expect(removedAccountMessage('claude-account-work')).toContain('(work)');
  });
});
