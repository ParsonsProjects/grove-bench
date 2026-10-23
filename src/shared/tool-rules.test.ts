import { describe, it, expect } from 'vitest';
import { checkToolRulePattern } from './tool-rules.js';

describe('checkToolRulePattern', () => {
  it('accepts keywords, provider tool names and mcp rules', () => {
    for (const rule of ['shell(npm run *)', 'edit(src/**)', 'question', 'Shell(git *)', 'Bash(git push *)', 'PowerShell', 'mcp(github__*)', 'mcp__github__create_issue']) {
      expect(checkToolRulePattern(rule), rule).toBeNull();
    }
  });

  it('refuses a rule that can never match, and offers the closed bracket', () => {
    expect(checkToolRulePattern('shell(rm -rf *')).toEqual({ error: expect.stringContaining('Did you mean shell(rm -rf *)?') });
    expect(checkToolRulePattern('(npm *)')).toEqual({ error: expect.stringContaining('Not a rule') });
    expect(checkToolRulePattern('shell(npm) x')).toEqual({ error: expect.stringContaining('Not a rule') });
  });

  it('hints at a command typed without brackets', () => {
    expect(checkToolRulePattern('shell npm run *')).toEqual({ hint: expect.stringContaining('write shell(npm run *)') });
  });

  it('hints at a lowercase word that is not a keyword', () => {
    expect(checkToolRulePattern('shel(npm *)')).toEqual({ hint: expect.stringContaining('"shel" isn\'t a rule keyword') });
    expect(checkToolRulePattern('powershell(Remove-Item *)')).toEqual({ hint: expect.stringContaining('"powershell"') });
  });

  it('is not fooled by names on Object.prototype', () => {
    expect(checkToolRulePattern('constructor')).toEqual({ hint: expect.stringContaining('"constructor"') });
  });
});
