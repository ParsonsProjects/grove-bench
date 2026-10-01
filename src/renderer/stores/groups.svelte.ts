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
 * A conversation is in at most one group. Groups are short-lived: one goes
 * when its last conversation leaves it or is deleted. Saved through main in
 * app-state.json.
 */

/** What the group name dialog is asking for. */
export type GroupNameRequest =
  /** A new group. With a conversation, it moves into the group; without one,
   *  a draft conversation opens in the group once it exists. */
  | { kind: 'new'; sessionId?: string }
  | { kind: 'rename'; groupId: string };

const DEFAULT_NAME = 'New group';

class GroupStore {
  groups = $state<ConversationGroup[]>([]);
  /** The open group name dialog, or null. Set from the conversation menu and
   *  the Groups section; the dialog lives in the Groups section. */
  nameRequest = $state<GroupNameRequest | null>(null);

  async load(): Promise<void> {
    try {
      this.groups = await window.groveBench.getConversationGroups();
    } catch (e) {
      console.warn('[groups] could not load conversation groups:', e);
    }
  }

  get(id: string): ConversationGroup | null {
    return this.groups.find((g) => g.id === id) ?? null;
  }

  groupOf(sessionId: string): ConversationGroup | null {
    return this.groups.find((g) => g.sessionIds.includes(sessionId)) ?? null;
  }

  /** The group's conversations the app has loaded, in the order they joined.
   *  One in a project that didn't load (its folder is missing) is left out
   *  here but stays in the group. */
  members(id: string): typeof sessionStore.sessions {
    const group = this.get(id);
    if (!group) return [];
    return group.sessionIds.flatMap((sid) => sessionStore.sessions.find((s) => s.id === sid) ?? []);
  }

  /** Start a group, moving `sessionIds` into it from wherever they were. */
  create(name: string, sessionIds: string[] = []): ConversationGroup {
    const group: ConversationGroup = {
      id: crypto.randomUUID().slice(0, 8),
      name: name.trim() || DEFAULT_NAME,
      createdAt: Date.now(),
      sessionIds: [...sessionIds],
    };
    this.save([...this.without(sessionIds), group]);
    return group;
  }

  rename(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.save(this.groups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)));
  }

  /** Put a conversation in a group, taking it out of any other. */
  add(groupId: string, sessionId: string): void {
    if (!this.get(groupId) || this.get(groupId)!.sessionIds.includes(sessionId)) return;
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

  /** The groups with `sessionIds` taken out. A group they leave empty goes;
   *  one that was empty already (just created) stays. */
  private without(sessionIds: string[]): ConversationGroup[] {
    if (sessionIds.length === 0) return this.groups;
    const leaving = new Set(sessionIds);
    return this.groups.flatMap((g) => {
      if (!g.sessionIds.some((sid) => leaving.has(sid))) return [g];
      const kept = g.sessionIds.filter((sid) => !leaving.has(sid));
      return kept.length > 0 ? [{ ...g, sessionIds: kept }] : [];
    });
  }

  private save(next: ConversationGroup[]): void {
    this.groups = next;
    window.groveBench.setConversationGroups($state.snapshot(this.groups) as ConversationGroup[]);
  }
}

export const groupStore = new GroupStore();
