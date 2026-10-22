import { CONTROL_IDS } from '../../shared/types.js';
import { recipePrompt, type Recipe, type RecipeInput, type RecipeOutcome } from '../../shared/recipes.js';
import { store as sessionStore } from './sessions.svelte.js';
import { draftStore } from './draft.svelte.js';
import { agentsStore } from './agents.svelte.js';
import { settingsStore } from './settings.svelte.js';

/**
 * Recipes in the window: the list main keeps (main/recipes.ts), and running
 * one, which starts a thread as Add Skill's "Ask Agent to Write It" does. Run
 * by hand, the thread opens; on a schedule it starts without taking the
 * screen, and not at all while the recipe has `maxOpen` threads still open.
 */
class RecipesStore {
  list = $state<Recipe[]>([]);
  /** Recipes whose run is starting, so Run can't start two at once. */
  starting = $state<Record<string, boolean>>({});
  private started = false;

  init(): void {
    if (this.started) return;
    this.started = true;
    // Main sends the list before a due id, so the recipe is here to run.
    window.groveBench.onRecipesChanged((list) => { this.list = list; });
    window.groveBench.onRecipeDue((id) => {
      const recipe = this.list.find((r) => r.id === id);
      if (recipe) void this.run(recipe, { scheduled: true });
    });
    void this.load();
  }

  async load(): Promise<void> {
    try {
      this.list = await window.groveBench.listRecipes();
    } catch (err) {
      console.error('Failed to load recipes:', err);
    }
  }

  forRepo(repoPath: string): Recipe[] {
    return this.list.filter((r) => r.repoPath === repoPath);
  }

  async save(input: RecipeInput): Promise<Recipe> {
    const saved = await window.groveBench.saveRecipe($state.snapshot(input) as RecipeInput);
    this.put(saved);
    return saved;
  }

  async remove(id: string): Promise<void> {
    await window.groveBench.deleteRecipe(id);
    this.list = this.list.filter((r) => r.id !== id);
  }

  /** The recipe's threads still in the Threads list: not closed or deleted. */
  openThreads(recipe: Recipe): number {
    const ids = new Set(recipe.sessionIds);
    return sessionStore.sessions.filter((s) => ids.has(s.id) && s.status !== 'stopped').length;
  }

  /** Why the recipe can't run now, or null when it can. */
  private blocker(recipe: Recipe, scheduled: boolean): Omit<RecipeOutcome, 'at'> | null {
    if (!sessionStore.repos.includes(recipe.repoPath)) return { error: 'Its project was removed' };
    // Not quietly swapped for the default agent: the recipe's tools (an MCP
    // server for the issue tracker) may only be set up in this one.
    const agent = agentsStore.get(recipe.agentId);
    if (recipe.agentId && agentsStore.loaded && (!agent || !agentsStore.isOffered(agent.id, settingsStore.current.enabledAlphaAgents))) {
      return { error: 'Its agent is turned off or was removed' };
    }
    if (scheduled) {
      const open = this.openThreads(recipe);
      if (open >= recipe.maxOpen) return { skipped: open === 1 ? '1 thread from it is still open' : `${open} threads from it are still open` };
    }
    return null;
  }

  /** Start the recipe's thread. Returns whether it started. */
  async run(recipe: Recipe, { scheduled = false } = {}): Promise<boolean> {
    if (this.starting[recipe.id]) return false;
    const blocked = this.blocker(recipe, scheduled);
    if (blocked) {
      // A cap is the schedule working as set; anything else is worth a toast.
      if (blocked.error) sessionStore.setError(`Recipe "${recipe.name}" didn't run: ${blocked.error}.`);
      await this.record(recipe.id, blocked);
      return false;
    }
    this.starting = { ...this.starting, [recipe.id]: true };
    try {
      const id = await draftStore.startThreadFor({
        repoPath: recipe.repoPath,
        text: recipePrompt(recipe),
        ...(recipe.agentId ? { agentId: recipe.agentId } : {}),
        start: recipe.start === 'folder' ? { kind: 'folder' } : { kind: 'new', branchName: '', baseBranch: '' },
        ...(recipe.permissionMode ? { controls: { [CONTROL_IDS.permissionMode]: recipe.permissionMode } } : {}),
        focus: !scheduled,
      });
      // A refusal already went in a toast (startThreadFor).
      await this.record(recipe.id, id ? { sessionId: id } : { error: "The thread couldn't start" });
      return id !== null;
    } finally {
      const { [recipe.id]: _, ...rest } = this.starting;
      this.starting = rest;
    }
  }

  private async record(id: string, outcome: Omit<RecipeOutcome, 'at'>): Promise<void> {
    try {
      const saved = await window.groveBench.recordRecipeRun(id, outcome);
      if (saved) this.put(saved);
    } catch (err) {
      console.error('Failed to note a recipe run:', err);
    }
  }

  private put(recipe: Recipe): void {
    const i = this.list.findIndex((r) => r.id === recipe.id);
    this.list = i === -1 ? [...this.list, recipe] : this.list.map((r) => (r.id === recipe.id ? recipe : r));
  }
}

export const recipesStore = new RecipesStore();
