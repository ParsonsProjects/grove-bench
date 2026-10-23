/**
 * Skills across a project's conversations: the names agents report (so the
 * disabled-skills allowlist keeps plugin skills), and the post-turn analysis
 * that suggests new skills.
 */
import * as settings from './settings.js';
import { logger } from './logger.js';
import { worktreeManager } from './worktree-manager.js';
import { computeSkillsFilter } from './skills.js';
import { analyzeRepo as analyzeSkillSuggestions, getCachedSuggestions } from './skill-suggestions.js';
import { backgroundModelFor, newestAgent } from './background-tasks.js';
import { loadKnownSkills, saveKnownSkills } from './app-state.js';
import { getEventsDir } from './session-event-store.js';
import type { ManagedSession } from './session-types.js';

/** Wait after a finished turn before analysing, so a burst of turns gives one run. */
const SUGGESTION_DEBOUNCE_MS = 30_000;

export class SessionSkills {
  /** Union of skill names each repo's sessions have reported via system_init.
   *  Backed by persisted app state so plugin-provided skills (invisible to the
   *  on-disk scan) survive app restarts and stay in the allowlist when the
   *  user has disabled other skills. */
  private knownByRepo = new Map<string, Set<string>>();
  /** Per-repo debounce for post-turn suggestion analysis. */
  private suggestionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private known(repoPath: string): Set<string> {
    let known = this.knownByRepo.get(repoPath);
    if (!known) {
      known = new Set(loadKnownSkills(repoPath));
      this.knownByRepo.set(repoPath, known);
    }
    return known;
  }

  /** Remember skills a session reported, persisting any new ones. */
  record(repoPath: string, names: string[]): void {
    const known = this.known(repoPath);
    const before = known.size;
    for (const name of names) known.add(name);
    if (known.size !== before) {
      saveKnownSkills(repoPath, [...known].sort());
    }
  }

  /** Skill allowlist for a session, honoring settings.disabledSkills.
   *  Undefined when nothing is disabled or the provider has no skill support —
   *  the adapter option is then omitted so provider defaults apply. */
  async filterFor(session: ManagedSession, disabledSkills: string[]): Promise<string[] | undefined> {
    if (disabledSkills.length === 0 || session.adapter.capabilities.skills !== true) return undefined;
    const onDisk = session.adapter.listSkills
      ? await session.adapter.listSkills(session.worktreePath).catch(() => [])
      : [];
    const known = new Set(onDisk.map((s) => s.name));
    for (const name of this.known(session.repoPath)) known.add(name);
    return computeSkillsFilter(known, disabledSkills);
  }

  /** Schedule a suggestion analysis for the session's repo, debounced so a
   *  burst of finishing turns produces one run. */
  scheduleSuggestions(session: ManagedSession): void {
    if (!settings.getSettings().autoSkillSuggestions) return;
    if (session.adapter.capabilities.skills !== true) return;
    const { repoPath } = session;
    const pending = this.suggestionTimers.get(repoPath);
    if (pending) clearTimeout(pending);
    this.suggestionTimers.set(repoPath, setTimeout(() => {
      this.suggestionTimers.delete(repoPath);
      this.analyzeRepo(repoPath).catch((err) => {
        logger.warn(`[skill-suggestions] analysis failed for ${repoPath}:`, err);
      });
    }, SUGGESTION_DEBOUNCE_MS));
  }

  /** Mine the repo's session logs for recurring workflows and refresh the
   *  cached skill suggestions. Skills are an agent feature, so this runs on
   *  the project's most recently used agent that has them, with that agent's
   *  background model, and only reads that agent's conversations: content from
   *  one provider's conversations is never sent to another provider. Returns
   *  the cached suggestions untouched when no agent in the project has skills. */
  async analyzeRepo(repoPath: string) {
    const worktrees = await worktreeManager.list(repoPath);
    const adapter = newestAgent(worktrees, (a) => a.capabilities.skills === true);
    if (!adapter) return getCachedSuggestions(repoPath);
    const sessionIds = worktrees
      .filter((w) => w.agentType === adapter.id)
      .sort((a, b) => (a.lastActiveAt ?? a.createdAt) - (b.lastActiveAt ?? b.createdAt))
      .map((w) => w.id);
    const existingSkills = adapter.listSkills
      ? await adapter.listSkills(repoPath).catch(() => [])
      : [];
    const generateText = adapter.generateText?.bind(adapter);
    return analyzeSkillSuggestions({
      repoPath,
      sessionIds,
      eventsDir: getEventsDir(),
      existingSkills,
      generateText: generateText
        ? (system, user, options) => generateText(system, user, { ...options, model: backgroundModelFor(adapter) })
        : null,
    });
  }
}
