/**
 * Prototype switch for the new thread screen (DraftPane): other layouts and
 * wording to compare, picked from a bar on the draft in dev builds
 * (DraftPrototypeBar) or with ?footer=…&picker=…&copy=…&discard=… on
 * demo.html. 'current' is the shipped behaviour, and the default, so
 * nothing changes until a prototype is picked. Kept in localStorage so a
 * reload keeps the pick.
 */

export const DRAFT_PROTOTYPES = {
  /** The options bar along the foot of the message box, in a narrow pane. */
  footer: {
    current: 'One row, as shipped',
    compact: 'One row that drops details as it narrows',
    wrap: 'Wraps onto a second row',
    outside: 'Options under the box, Start alone in it',
  },
  /** Branches the picker lists that are checked out somewhere already. */
  picker: {
    current: 'Listed, as shipped (fails on start)',
    hide: 'Hidden, with a note saying which',
    grey: 'Greyed out, with where they are',
    redirect: "The project folder's branch picks Project folder",
  },
  /** The text around the message box. */
  copy: {
    current: 'As shipped',
    trim: 'Plan under the box, mode only when not Ask',
    plan: 'Plan above the box, nothing under it',
  },
  /** The Discard button. */
  discard: {
    current: 'One click, as shipped',
    confirm: 'Asks first when there is a message',
    undo: 'Discards at once, with Undo',
  },
} as const;

type Prototypes = typeof DRAFT_PROTOTYPES;
export type DraftPrototypeKey = keyof Prototypes;
type DraftPrototype = { [K in DraftPrototypeKey]: keyof Prototypes[K] };

const STORAGE_KEY = 'grove-bench:draft-prototype';
const DEFAULTS: DraftPrototype = { footer: 'current', picker: 'current', copy: 'current', discard: 'current' };

function isOption<K extends DraftPrototypeKey>(key: K, value: unknown): value is keyof Prototypes[K] {
  return typeof value === 'string' && Object.hasOwn(DRAFT_PROTOTYPES[key], value);
}

function load(): DraftPrototype {
  const picked = { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!saved || typeof saved !== 'object') return picked;
    for (const key of Object.keys(DEFAULTS) as DraftPrototypeKey[]) {
      const value = (saved as Record<string, unknown>)[key];
      if (isOption(key, value)) (picked as Record<string, unknown>)[key] = value;
    }
  } catch {
    // No storage, or something else in it: the shipped screen.
  }
  return picked;
}

class DraftPrototypeStore {
  current = $state<DraftPrototype>(load());

  set<K extends DraftPrototypeKey>(key: K, value: keyof Prototypes[K]): void {
    this.current = { ...this.current, [key]: value };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.current));
    } catch {
      // Kept for this window only.
    }
  }
}

export const draftPrototype = new DraftPrototypeStore();
