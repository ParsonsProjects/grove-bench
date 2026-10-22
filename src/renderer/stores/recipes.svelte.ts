import { CONTROL_IDS } from '../../shared/types.js';
import { recipePrompt, type Recipe, type RecipeInput, type RecipeOutcome } from '../../shared/recipes.js';
import { store as sessionStore } from './sessions.svelte.js';
import { draftStore, type ThreadStart } from './draft.svelte.js';

/** How often, and how many times, to ask again while app-state.json can't be
 *  read (a passing lock, usually an antivirus scan). */
const LOAD_RETRY_MS = 1000;
const LOAD_ATTEMPTS = 5;

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
    window.groveBench.onRecipesChanged((list) => { this.list = list; });
    window.groveBench.onRecipeDue((id) => void this.runDue(id));
    void this.load();
  }

  async load(retryMs = LOAD_RETRY_MS): Promise<void> {
    for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt++) {
      try {
        const list = await window.groveBench.listRecipes();
        if (list) {
          this.list = list;
          return;
        }
      } catch (err) {
        console.warn('[recipes] could not load the recipes:', err);
      }
      if (attempt < LOAD_ATTEMPTS) await new Promise((r) => setTimeout(r, retryMs));
    }
    console.warn('[recipes] app-state.json stayed unreadable; recipes show once one runs');
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

  /** The recipe's threads still in the Threads list: not closed or deleted.
   *  Threads waiting to reconnect after a restart or a wake count. */
  openThreads(recipe: Recipe): number {
    const ids = new Set(recipe.sessionIds);
    return sessionStore.sessions.filter((s) => ids.has(s.id) && sessionStore.isOpenTab(s)).length;
  }

  /** A scheduled run main says is due. One for a recipe this window doesn't
   *  have yet (the list failed to load) fetches the list first. */
  private async runDue(id: string): Promise<void> {
    let recipe = this.list.find((r) => r.id === id);
    if (!recipe) {
      await this.load(0);
      recipe = this.list.find((r) => r.id === id);
    }
    if (recipe) await this.run(recipe, { scheduled: true });
    else console.warn(`[recipes] ${id} is due but isn't in the list (deleted meanwhile?)`);
  }

  /** Start the recipe's thread, and note what happened. Returns whether a
   *  thread started. */
  async run(recipe: Recipe, { scheduled = false } = {}): Promise<boolean> {
    if (this.starting[recipe.id]) {
      // Run by hand twice: the second click does nothing. Due while a run by
      // hand starts: that run stands in for it.
      if (scheduled) await this.record(recipe.id, { skipped: 'a run by hand was starting' });
      return false;
    }
    if (scheduled) {
      const open = this.openThreads(recipe);
      if (open >= recipe.maxOpen) {
        // The cap working as set: noted, no toast.
        await this.record(recipe.id, { skipped: open === 1 ? '1 thread from it is still open' : `${open} threads from it are still open` });
        return false;
      }
    }
    this.starting = { ...this.starting, [recipe.id]: true };
    try {
      let result: ThreadStart;
      try {
        result = await draftStore.startThreadFor({
          repoPath: recipe.repoPath,
          text: recipePrompt(recipe),
          ...(recipe.agentId ? { agentId: recipe.agentId } : {}),
          start: recipe.start === 'folder' ? { kind: 'folder' } : { kind: 'new', branchName: '', baseBranch: '' },
          ...(recipe.permissionMode ? { controls: { [CONTROL_IDS.permissionMode]: recipe.permissionMode } } : {}),
          focus: !scheduled,
          strictAgent: true,
          quiet: true,
        });
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      if ('error' in result) {
        sessionStore.setError(`Recipe "${recipe.name}" didn't start a thread: ${result.error.replace(/\.+$/, '')}.`);
        await this.record(recipe.id, { error: result.error });
        return false;
      }
      await this.record(recipe.id, { sessionId: result.id });
      return true;
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
