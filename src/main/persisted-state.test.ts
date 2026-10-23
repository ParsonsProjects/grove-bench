import { describe, it, expect } from 'vitest';
import { migrateRaw, readSchemaVersion, stampSchemaVersion, type Migration } from './persisted-state.js';

describe('readSchemaVersion', () => {
  it('treats missing, non-object, or malformed stamps as version 0', () => {
    expect(readSchemaVersion(undefined)).toBe(0);
    expect(readSchemaVersion(null)).toBe(0);
    expect(readSchemaVersion('x')).toBe(0);
    expect(readSchemaVersion([])).toBe(0);
    expect(readSchemaVersion({})).toBe(0);
    expect(readSchemaVersion({ schemaVersion: '2' })).toBe(0);
    expect(readSchemaVersion({ schemaVersion: -1 })).toBe(0);
    expect(readSchemaVersion({ schemaVersion: 1.5 })).toBe(0);
  });

  it('reads a valid integer stamp', () => {
    expect(readSchemaVersion({ schemaVersion: 3 })).toBe(3);
  });
});

describe('migrateRaw', () => {
  const migrations: Migration[] = [
    // 0 → 1: rename `old` to `renamed`
    (raw) => { const { old, ...rest } = raw; return { ...rest, renamed: old }; },
    // 1 → 2: add a derived field
    (raw) => ({ ...raw, derived: `${raw.renamed}!` }),
  ];

  it('runs every migration from an unversioned file and strips the stamp', () => {
    const r = migrateRaw({ old: 'a' }, migrations, 2);
    expect(r.data).toEqual({ renamed: 'a', derived: 'a!' });
    expect(r.fromVersion).toBe(0);
    expect(r.migrated).toBe(true);
    expect(r.newerThanApp).toBe(false);
  });

  it('starts from the stamped version', () => {
    const r = migrateRaw({ schemaVersion: 1, renamed: 'b' }, migrations, 2);
    expect(r.data).toEqual({ renamed: 'b', derived: 'b!' });
    expect(r.fromVersion).toBe(1);
  });

  it('is a no-op for a current file', () => {
    const r = migrateRaw({ schemaVersion: 2, renamed: 'c', derived: 'c!' }, migrations, 2);
    expect(r.data).toEqual({ renamed: 'c', derived: 'c!' });
    expect(r.migrated).toBe(false);
  });

  it('keeps a newer file as-is and flags it', () => {
    const r = migrateRaw({ schemaVersion: 9, future: true }, migrations, 2);
    expect(r.data).toEqual({ future: true });
    expect(r.newerThanApp).toBe(true);
    expect(r.migrated).toBe(true);
  });

  it('treats non-object input as an empty version-0 file', () => {
    expect(migrateRaw('garbage', migrations, 2).data).toEqual({ renamed: undefined, derived: 'undefined!' });
    expect(migrateRaw(null, [], 0).data).toEqual({});
  });

  it('stops at a throwing migration without losing data', () => {
    const bad: Migration[] = [() => { throw new Error('boom'); }, migrations[1]];
    const r = migrateRaw({ renamed: 'd' }, bad, 2);
    expect(r.data).toEqual({ renamed: 'd' });
    expect(r.migrated).toBe(false);
  });

  it('does not mutate the input', () => {
    const input = { schemaVersion: 0, old: 'e' };
    migrateRaw(input, migrations, 2);
    expect(input).toEqual({ schemaVersion: 0, old: 'e' });
  });
});

describe('stampSchemaVersion', () => {
  it('puts the stamp first and keeps the fields', () => {
    const out = stampSchemaVersion({ a: 1 }, 4);
    expect(Object.keys(out)).toEqual(['schemaVersion', 'a']);
    expect(out).toEqual({ schemaVersion: 4, a: 1 });
  });
});
