/**
 * Schema versioning for JSON files persisted under userData (settings.json,
 * app-state.json).
 *
 * Each file carries a top-level `schemaVersion`. A file without one is
 * version 0 (everything written before versioning shipped). On load the raw
 * object is run through the ordered migration list — `migrations[n]` upgrades
 * a version-n object to version n+1 — until it reaches the current version,
 * then validated field by field so one corrupt value falls back to its
 * default instead of discarding the whole file.
 */

export type RawRecord = Record<string, unknown>;

/** Upgrade a version-n object to version n+1. Must not throw on odd input. */
export type Migration = (raw: RawRecord) => RawRecord;

export interface MigrateResult {
  /** The object after migrations, with `schemaVersion` stripped. */
  data: RawRecord;
  /** Version the file was at before migrating (0 = unversioned). */
  fromVersion: number;
  /** True when at least one migration ran, or the file was newer than us. */
  migrated: boolean;
  /** True when the file was written by a newer app version. Its contents are
   *  kept as-is (unknown fields are dropped by validation, known ones used). */
  newerThanApp: boolean;
}

export function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read the version stamp off a raw object; missing or malformed = 0. */
export function readSchemaVersion(raw: unknown): number {
  if (!isRecord(raw)) return 0;
  const v = raw.schemaVersion;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
}

/**
 * Bring `raw` up to `currentVersion`. Non-object input is treated as an empty
 * version-0 file. A migration that throws is logged (by the caller, via the
 * returned data being unchanged for that step) — here we stop migrating and
 * return what we have, so a bad migration never wipes a user's file.
 */
export function migrateRaw(
  raw: unknown,
  migrations: readonly Migration[],
  currentVersion: number,
): MigrateResult {
  const fromVersion = readSchemaVersion(raw);
  let data: RawRecord = isRecord(raw) ? { ...raw } : {};
  delete data.schemaVersion;

  if (fromVersion > currentVersion) {
    return { data, fromVersion, migrated: true, newerThanApp: true };
  }

  let migrated = false;
  for (let v = fromVersion; v < currentVersion; v++) {
    const step = migrations[v];
    if (!step) break; // gap in the migration table — leave the rest untouched
    try {
      data = step(data);
      migrated = true;
    } catch {
      break;
    }
  }
  return { data, fromVersion, migrated, newerThanApp: false };
}

/** Attach the version stamp for writing. Placed first so it is easy to spot
 *  when reading the file by hand. */
export function stampSchemaVersion<T extends object>(data: T, version: number): { schemaVersion: number } & T {
  return { schemaVersion: version, ...data };
}
