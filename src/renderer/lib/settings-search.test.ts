import { describe, it, expect } from 'vitest';
import { searchSettings, SETTINGS_INDEX, SETTINGS_SECTIONS } from './settings-search.js';

const ALL = SETTINGS_SECTIONS.map((s) => s.id);
const ids = (query: string, sections = ALL) => searchSettings(query, sections).map((e) => e.id);

describe('searchSettings', () => {
  it('finds a setting by its label', () => {
    expect(ids('idle')).toEqual(['idle-sleep']);
    expect(ids('crash')).toEqual(['crash-reports']);
  });

  it('finds a setting by another word for it', () => {
    expect(ids('api key')).toContain('credentials');
    expect(ids('caveman')).toContain('response-style');
  });

  it('finds every setting in a section by the section name', () => {
    expect(ids('notif').sort()).toEqual(
      SETTINGS_INDEX.filter((e) => e.section === 'notifications').map((e) => e.id).sort(),
    );
  });

  it('leaves out sections that are not shown', () => {
    expect(ids('mcp', ['general', 'agents'])).toEqual([]);
  });

  it('returns nothing for an empty query', () => {
    expect(ids('   ')).toEqual([]);
  });

  it('has a unique id for every setting', () => {
    expect(new Set(SETTINGS_INDEX.map((e) => e.id)).size).toBe(SETTINGS_INDEX.length);
  });
});
