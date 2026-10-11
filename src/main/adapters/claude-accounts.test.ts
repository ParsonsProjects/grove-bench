import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { accountEnv, accountSignInCommand, claudeAccounts, CLAUDE_ACCOUNT_PREFIX, INHERITED_SIGN_IN_ENV } from './claude-accounts.js';

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

  it('covers the env credentials and provider switches above /login', () => {
    for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
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
  it("runs Claude Code's own sign-in with the account's folder, in PowerShell", () => {
    expect(accountSignInCommand('C:\\Users\\me\\.claude-work')).toBe("$env:CLAUDE_CONFIG_DIR = 'C:\\Users\\me\\.claude-work'; claude auth login");
  });

  it('keeps a quote in the folder name inside the string', () => {
    expect(accountSignInCommand("C:\\Users\\o'neil\\.claude-work")).toBe("$env:CLAUDE_CONFIG_DIR = 'C:\\Users\\o''neil\\.claude-work'; claude auth login");
  });
});
