import { describe, it, expect } from 'vitest';
import { alwaysAllowLabel } from './always-allow.js';

describe('alwaysAllowLabel', () => {
  it('says a shell approval covers every command', () => {
    const { label, title } = alwaysAllowLabel('Bash', 'bash');
    expect(label).toBe('Allow all commands');
    expect(title).toContain('every shell command');
  });

  it('goes by category for other agents\' shell tools', () => {
    expect(alwaysAllowLabel('shell_exec', 'bash').label).toBe('Allow all commands');
  });

  it('says a web fetch approval covers any address', () => {
    const { label, title } = alwaysAllowLabel('WebFetch', 'web_fetch');
    expect(label).toBe('Allow all web fetches');
    expect(title).toContain('any web address');
  });

  it('tells edits and new files apart', () => {
    expect(alwaysAllowLabel('Edit', 'edit').label).toBe('Allow all edits');
    expect(alwaysAllowLabel('Edit', 'edit').title).toContain('Creating new files still asks');
    expect(alwaysAllowLabel('Write', 'edit').label).toBe('Allow all file writes');
  });

  it('names an MCP tool by its own name', () => {
    expect(alwaysAllowLabel('mcp__grove-preview__preview_click').label).toBe('Always allow preview click');
  });

  it('falls back to the raw tool name', () => {
    expect(alwaysAllowLabel('Task').label).toBe('Always allow Task');
    expect(alwaysAllowLabel('mcp__broken').label).toBe('Always allow mcp__broken');
  });

  it('says how long the choice lasts', () => {
    expect(alwaysAllowLabel('Bash', 'bash').title).toContain('until you stop the conversation or restart Grove Bench');
  });
});
