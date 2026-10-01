import type { ConversationGroup } from '../../shared/types.js';
import { isTempBranch } from '../../shared/temp-branch.js';
import { store as sessionStore } from './sessions.svelte.js';

/**
 * Conversation groups: a few conversations, usually in different projects,
 * that belong to one piece of work (an API change and the web change that
 * uses it). Each conversation still runs in its own project with its own
 * agent; a group only lists them together in the sidebar, and a conversation
 * started from a group joins it on the same branch name.
 *
 * A conversation is in at most one group, and a group always has at least
 * one: it is made with its first conversation and goes when its last leaves
 * or is deleted. Saved through main in app-state.json.
 */

/** What the group name dialog is asking for. */
export type GroupNameRequest =
  /** A new group. With a conversation, it moves into the group; without one,
   *  a draft conversation opens, and the group is made when it starts. */
  | { kind: 'new'; sessionId?: string }
  | { kind: 'rename'; groupId: string };

/** The name a group gets when none is given. */
export function groupName(raw: string): string {
  return raw.trim() || 'New group';
}

/** How often, and how many times, to ask again while app-state.json can't be
 *  read (a passing lock, usually an antivirus scan). */
const LOAD_RETRY_MS = 1000;
const LOAD_ATTEMPTS = 5;

class GroupStore {
  groups = $state<ConversationGroup[]>([]);
  /** The saved groups have been read. Until then nothing is saved, so a list
   *  that failed to load can't be written over the real one; the Groups
   *  section and menu items stay hidden. */
  ready = $state(false);
  /** The open group name dialog, or null. Set from the conversation menu and
   *  the Groups section; the dialog lives in the Groups section. */
  nameRequest = $state<GroupNameRequest | null>(null);

  // Every sidebar row looks its group up, and every group its conversations,
  // so both are maps rather than scans.
  private groupBySession = $derived(new Map(this.groups.flatMap((g) => g.sessionIds.map((id) => [id, g] as const))));
  private sessionById = $derived(new Map(sessionStore.sessions.map((s) => [s.id, s] as const)));

  async load(retryMs = LOAD_RETRY_MS): Promise<void> {
    for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt++) {
      try {
        const groups = await window.groveBench.getConversationGroups();
        if (groups) {
          this.groups = groups;
          this.ready = true;
          return;
        }
      } catch (e) {
        console.warn('[groups] could not load conversation groups:', e);
      }
      if (attempt < LOAD_ATTEMPTS) await new Promise((r) => setTimeout(r, retryMs));
    }
    console.warn('[groups] app-state.json stayed unreadable; groups are off until the next launch');
  }

  get(id: string): ConversationGroup | null {
    return this.groups.find((g) => g.id === id) ?? null;
  }

  groupOf(sessionId: string): ConversationGroup | null {
    return this.groupBySession.get(sessionId) ?? null;
  }

  /** The group's conversations the app has loaded, in the order they joined.
   *  One in a project that didn't load (its folder is missing) is left out
   *  here but stays in the group. */
  members(id: string): typeof sessionStore.sessions {
    return (this.get(id)?.sessionIds ?? []).flatMap((sid) => this.sessionById.get(sid) ?? []);
  }

  /** Start a group with `sessionIds`, moving them from wherever they were. */
  create(name: string, sessionIds: string[]): ConversationGroup | null {
    if (sessionIds.length === 0) return null;
    const group: ConversationGroup = {
      id: crypto.randomUUID().slice(0, 8),
      name: groupName(name),
      sessionIds: [...new Set(sessionIds)],
    };
    return this.save([...this.without(sessionIds), group]) ? group : null;
  }

  rename(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.save(this.groups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)));
  }

  /** Put a conversation in a group, taking it out of any other. Nothing
   *  happens when the group is gone (ungrouped meanwhile). */
  add(groupId: string, sessionId: string): void {
    const group = this.get(groupId);
    if (!group || group.sessionIds.includes(sessionId)) return;
    const rest = this.without([sessionId]);
    this.save(rest.map((g) => (g.id === groupId ? { ...g, sessionIds: [...g.sessionIds, sessionId] } : g)));
  }

  /** Take a conversation out of its group. Also used when it is deleted. */
  remove(sessionId: string): void {
    if (!this.groupOf(sessionId)) return;
    this.save(this.without([sessionId]));
  }

  /** Drop a group. Its conversations stay as they are. */
  ungroup(id: string): void {
    if (!this.get(id)) return;
    this.save(this.groups.filter((g) => g.id !== id));
  }

  /**
   * The branch name a new conversation in the group starts on in `repo`: the
   * branch of its first conversation that has a real one. Conversations in
   * the project folder (direct) are skipped, as they run on whatever is
   * checked out, and so are placeholder branches not yet renamed after the
   * first reply. Empty when the group already has a conversation in `repo`:
   * that one has the branch there, and a second can't check it out too.
   */
  sharedBranch(id: string, repo: string): string {
    const members = this.members(id);
    if (members.some((s) => s.repoPath === repo)) return '';
    const source = members.find((s) => !s.direct && !s.noGit && s.branch && !isTempBranch(s.branch));
    return source?.branch ?? '';
  }

  /** The project a new conversation in the group most likely goes in: the
   *  first project with nothing in the group yet, else the first member's. */
  nextProject(id: string): string {
    const members = this.members(id);
    const used = new Set(members.map((s) => s.repoPath));
    return sessionStore.repos.find((r) => !used.has(r)) ?? members[0]?.repoPath ?? '';
  }

  /** The groups with `sessionIds` taken out. A group left with none goes. */
  private without(sessionIds: string[]): ConversationGroup[] {
    const leaving = new Set(sessionIds);
    return this.groups.flatMap((g) => {
      if (!g.sessionIds.some((sid) => leaving.has(sid))) return [g];
      const kept = g.sessionIds.filter((sid) => !leaving.has(sid));
      return kept.length > 0 ? [{ ...g, sessionIds: kept }] : [];
    });
  }

  /** Apply and save a change. Refused (false) until the saved groups have
   *  been read, so they are never written over with a partial list. */
  private save(next: ConversationGroup[]): boolean {
    if (!this.ready) return false;
    this.groups = next;
    window.groveBench.setConversationGroups($state.snapshot(this.groups) as ConversationGroup[]);
    return true;
  }
}

export const groupStore = new GroupStore();
