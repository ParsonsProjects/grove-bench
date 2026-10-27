/**
 * Skills across a project's threads: Claude Code's links to shared skills,
 * brought up to date as a thread starts; the skills it starts with turned
 * off; a check that the skill a thread asks for is there; and the post-turn
 * analysis that suggests new skills.
 */
import * as settings from './settings.js';
import { logger } from './logger.js';
import { worktreeManager } from './worktree-manager.js';
import { adapterRegistry } from './adapters/index.js';
import { claudeAccounts } from './adapters/claude-accounts.js';
import { readsSharedSkills } from './skills.js';
import { linkSkills } from './skill-sharing.js';
import { analyzeRepo as analyzeSkillSuggestions, getCachedSuggestions } from './skill-suggestions.js';
import { backgroundModelFor, newestAgent } from './background-tasks.js';
import { getEventsDir } from './session-event-store.js';
import { splitSkillLine } from '../shared/skill-line.js';
import type { AgentEvent } from '../shared/types.js';
import type { ManagedSession } from './session-types.js';

/** Every current Claude account's own user skills folder, which sees
 *  personal shared skills only through links. Grove keeps one in each
 *  (SkillDirs.userLinks), so a personal skill reaches every Claude thread.
 *  An account taken out of Settings is left alone. */
export function accountLinkDirs(): string[] {
  const current = new Set(claudeAccounts(settings.getSettings().claudeAccounts).map((a) => a.id));
  return adapterRegistry.list()
    .filter((a) => !a.account || current.has(a.id))
    .flatMap((a) => (a.skillDirs && !readsSharedSkills(a.skillDirs, 'user') ? [a.skillDirs.user[0]] : []));
}

/** The warning a thread shows when the skill its message asks for isn't
 *  one its agent has. */
export function missingSkillWarning(skill: string, agentName: string): string {
  return `This thread asks for the "${skill}" skill, but ${agentName} has no skill by that name here. It may be turned off, renamed, or not on this branch yet.`;
}

/**
 * The skill the thread's latest message asks for ("Use the `x` skill..."),
 * when the agent's report of what it has (system_init) doesn't list it.
 * Null when the message asks for none, the agent lists nothing to check
 * against, or the skill is there.
 */
export function missingSkill(history: readonly AgentEvent[], skills: readonly string[], commands: readonly string[] = []): string | null {
  if (skills.length === 0) return null;
  let latest: string | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const event = history[i];
    if (event.type === 'user_message') {
      latest = event.text;
      break;
    }
  }
  const asked = latest === null ? null : splitSkillLine(latest)?.skill ?? null;
  if (!asked || skills.includes(asked) || commands.includes(asked)) return null;
  return asked;
}

/** Wait after a finished turn before analysing, so a burst of turns gives one run. */
const SUGGESTION_DEBOUNCE_MS = 30_000;

export class SessionSkills {
  /** Per-repo debounce for post-turn suggestion analysis. */
  private suggestionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** The skills a session starts with turned off (settings.disabledSkills).
   *  Undefined when none are or Grove doesn't manage the agent's skills, so
   *  the provider's defaults apply. */
  disabledFor(session: ManagedSession, disabledSkills: string[]): string[] | undefined {
    if (disabledSkills.length === 0 || session.adapter.capabilities.skills !== true) return undefined;
    return [...disabledSkills];
  }

  /** Before an agent that sees shared skills only through links (Claude
   *  Code) starts, bring its links up to date: a new worktree has only the
   *  links that were committed, so a shared skill added without one would
   *  otherwise stay out of sight. Best effort. */
  async keepLinks(session: ManagedSession): Promise<void> {
    const dirs = session.adapter.skillDirs;
    if (!dirs || (readsSharedSkills(dirs, 'project') && readsSharedSkills(dirs, 'user'))) return;
    try {
      const { skipped } = await linkSkills(session.worktreePath, { ...dirs, userLinks: accountLinkDirs() });
      for (const { name, reason } of skipped) logger.warn(`[skills] ${session.id}: couldn't link "${name}": ${reason}`);
    } catch (err) {
      logger.warn(`[skills] ${session.id}: couldn't bring skill links up to date:`, err);
    }
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
