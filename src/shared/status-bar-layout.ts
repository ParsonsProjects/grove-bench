/**
 * The thread status bar's layout (`statusBarLayout`): which parts it shows,
 * in what order, and on which side. One rule, used by the settings schema,
 * the bar itself and its Settings list, so what Settings shows is what the
 * bar draws.
 */

/** The bar's parts, in their default order. */
export const STATUS_BAR_PART_IDS = [
  'agent',
  'activity',
  'thread-items',
  'last-turn',
  'capabilities',
  'branch',
  'context',
  'keys',
] as const;

export type StatusBarPartId = (typeof STATUS_BAR_PART_IDS)[number];
export type StatusBarSide = 'left' | 'right';

export interface StatusBarPart {
  id: StatusBarPartId;
  side: StatusBarSide;
  shown: boolean;
}

/** Always shown: it is where the model and mode are picked, and where the
 *  plan usage alert's View usage opens. It can still move. */
export const ALWAYS_SHOWN_PART: StatusBarPartId = 'agent';

const DEFAULT_SIDE: Record<StatusBarPartId, StatusBarSide> = {
  agent: 'left',
  activity: 'left',
  'thread-items': 'left',
  'last-turn': 'left',
  capabilities: 'left',
  branch: 'left',
  context: 'right',
  keys: 'right',
};

/** A fresh copy of the default layout, safe to edit. */
export function defaultStatusBarLayout(): StatusBarPart[] {
  return STATUS_BAR_PART_IDS.map((id) => ({ id, side: DEFAULT_SIDE[id], shown: true }));
}

function isPartId(value: unknown): value is StatusBarPartId {
  return typeof value === 'string' && (STATUS_BAR_PART_IDS as readonly string[]).includes(value);
}

/** The layout for a saved value: unknown parts and repeats dropped, a part
 *  the save doesn't name (one added since) shown at the end of its default
 *  side, and the left side's parts listed before the right's. Never throws. */
export function normalizeStatusBarLayout(saved: unknown): StatusBarPart[] {
  if (!Array.isArray(saved)) return defaultStatusBarLayout();
  const parts: StatusBarPart[] = [];
  const seen = new Set<StatusBarPartId>();
  for (const entry of saved as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, side, shown } = entry as Record<string, unknown>;
    if (!isPartId(id) || seen.has(id)) continue;
    seen.add(id);
    parts.push({
      id,
      side: side === 'left' || side === 'right' ? side : DEFAULT_SIDE[id],
      shown: id === ALWAYS_SHOWN_PART || shown !== false,
    });
  }
  for (const id of STATUS_BAR_PART_IDS) {
    if (!seen.has(id)) parts.push({ id, side: DEFAULT_SIDE[id], shown: true });
  }
  return [...parts.filter((p) => p.side === 'left'), ...parts.filter((p) => p.side === 'right')];
}

/** Whether a layout is the default one. */
export function isDefaultStatusBarLayout(layout: readonly StatusBarPart[]): boolean {
  const defaults = defaultStatusBarLayout();
  return layout.length === defaults.length && layout.every((p, i) =>
    p.id === defaults[i].id && p.side === defaults[i].side && p.shown === defaults[i].shown);
}

/** Move a part to `side`, just before `beforeId` (a part on that side), or
 *  to the end of that side when `beforeId` is null or not there. */
export function moveStatusBarPart(
  layout: readonly StatusBarPart[],
  id: StatusBarPartId,
  side: StatusBarSide,
  beforeId: StatusBarPartId | null,
): StatusBarPart[] {
  const part = layout.find((p) => p.id === id);
  if (!part || beforeId === id) return [...layout];
  const rest = layout.filter((p) => p.id !== id);
  const left = rest.filter((p) => p.side === 'left');
  const right = rest.filter((p) => p.side === 'right');
  const target = side === 'left' ? left : right;
  const at = beforeId === null ? -1 : target.findIndex((p) => p.id === beforeId);
  target.splice(at === -1 ? target.length : at, 0, { ...part, side });
  return [...left, ...right];
}

/** Move a part one place up (-1) or down (1), as the keyboard does: from
 *  the top of the right side up to the end of the left side, and from the
 *  end of the left side down to the top of the right. Returns the layout
 *  unchanged at either end. */
export function stepStatusBarPart(
  layout: readonly StatusBarPart[],
  id: StatusBarPartId,
  step: -1 | 1,
): StatusBarPart[] {
  const part = layout.find((p) => p.id === id);
  if (!part) return [...layout];
  const left = layout.filter((p) => p.side === 'left');
  const right = layout.filter((p) => p.side === 'right');
  const own = part.side === 'left' ? left : right;
  const i = own.findIndex((p) => p.id === id);
  if (step === -1) {
    if (i > 0) return moveStatusBarPart(layout, id, part.side, own[i - 1].id);
    if (part.side === 'right') return moveStatusBarPart(layout, id, 'left', null);
    return [...layout];
  }
  if (i < own.length - 1) return moveStatusBarPart(layout, id, part.side, own[i + 2]?.id ?? null);
  if (part.side === 'left') return moveStatusBarPart(layout, id, 'right', right[0]?.id ?? null);
  return [...layout];
}

/** Show or hide a part. The always-shown part stays shown. */
export function setStatusBarPartShown(
  layout: readonly StatusBarPart[],
  id: StatusBarPartId,
  shown: boolean,
): StatusBarPart[] {
  return layout.map((p) => (p.id === id ? { ...p, shown: id === ALWAYS_SHOWN_PART || shown } : p));
}
