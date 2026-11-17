import type { SessionSortState } from '../../shared/types.js';

/**
 * The sidebar's layout (its width, the sort order, which projects are open)
 * as last saved, kept in localStorage as well as in main's app state. Main's
 * copy is the one that counts, but it comes back over IPC after the first
 * frame is drawn; this one is there for that frame, so the sidebar doesn't
 * draw the defaults and then jump to the saved layout.
 */
const KEY = 'grove-bench:sidebar-layout';

export interface SidebarLayout {
  width?: number;
  sort?: SessionSortState;
  collapsedRepos?: Record<string, boolean>;
}

/** The layout saved last time, without any part that doesn't read right. */
export function cachedSidebarLayout(): SidebarLayout {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    const saved = raw as Record<string, unknown>;
    const layout: SidebarLayout = {};
    if (typeof saved.width === 'number' && Number.isFinite(saved.width)) layout.width = saved.width;
    if (isSort(saved.sort)) layout.sort = saved.sort;
    if (saved.collapsedRepos && typeof saved.collapsedRepos === 'object') {
      layout.collapsedRepos = Object.fromEntries(
        Object.entries(saved.collapsedRepos).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'),
      );
    }
    return layout;
  } catch {
    return {};
  }
}

/** Keep `part` for the next start's first frame (main saves it too). */
export function cacheSidebarLayout(part: SidebarLayout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...cachedSidebarLayout(), ...part }));
  } catch {
    // Full or unavailable: main's copy still has it, a frame later.
  }
}

function isSort(value: unknown): value is SessionSortState {
  const sort = value as Partial<SessionSortState> | null;
  return !!sort && (sort.key === 'name' || sort.key === 'age') && (sort.dir === 'asc' || sort.dir === 'desc');
}
