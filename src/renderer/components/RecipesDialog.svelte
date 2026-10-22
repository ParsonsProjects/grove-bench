<script lang="ts">
  /**
   * A project's recipes: saved ways to start a thread, run by hand or on a
   * schedule (shared/recipes.ts). Lists them with when each runs next and
   * what its last run did, and adds or edits one.
   */
  import { onMount } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as Segmented from '$lib/components/ui/segmented/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { recipesStore } from '../stores/recipes.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { stripIpcErrorPrefix } from '../lib/mcp-errors.js';
  import { describeSchedule, MAX_OPEN_LIMIT, recipeNextRun, type Recipe, type RecipeInput } from '../../shared/recipes.js';
  import type { PermissionMode } from '../../shared/types.js';

  let { repoPath, onclose }: { repoPath: string; onclose: () => void } = $props();

  let open = $state(true);
  let editing = $state<RecipeInput | null>(null);
  let saving = $state(false);
  let formError = $state('');
  let confirmDeleteId = $state<string | null>(null);

  const recipes = $derived(recipesStore.forRepo(repoPath));
  const folderProject = $derived(store.isFolderProject(repoPath));
  const agents = $derived(agentsStore.offered(settingsStore.current.enabledAlphaAgents));

  // Agents load on first use, and nothing may have used them yet.
  onMount(() => { void agentsStore.load(); });

  /** An error from main, without Electron's "Error invoking remote method" wrapper. */
  const message = (e: unknown) => stripIpcErrorPrefix(e instanceof Error ? e.message : String(e));

  /** The Select's value for "the default": an empty value reads as nothing picked. */
  const DEFAULT = '_default';

  /** Claude Code's names for its modes; another agent without one starts on its default. */
  const MODES: { value: PermissionMode | typeof DEFAULT; label: string }[] = [
    { value: DEFAULT, label: "Agent's default" },
    { value: 'default', label: 'Ask' },
    { value: 'plan', label: 'Plan' },
    { value: 'acceptEdits', label: 'Edit' },
    { value: 'readSafe', label: 'Read-safe' },
    { value: 'auto', label: 'Auto' },
  ];

  function blank(): RecipeInput {
    return {
      repoPath,
      name: '',
      agentId: '',
      start: folderProject ? 'folder' : 'new',
      permissionMode: '',
      skill: '',
      prompt: '',
      schedule: { kind: 'manual' },
      maxOpen: 1,
      paused: false,
    };
  }

  /** The fields the form edits, as a plain copy: the store's recipes are
   *  state proxies, which can't be cloned or sent to main as they are. */
  function fieldsOf(recipe: Recipe): RecipeInput {
    const { scheduledFrom: _f, checkedThrough: _c, lastOutcome: _o, sessionIds: _s, ...fields } = $state.snapshot(recipe) as Recipe;
    return fields;
  }

  function edit(recipe: Recipe | null) {
    formError = '';
    confirmDeleteId = null;
    editing = recipe ? fieldsOf(recipe) : blank();
  }

  function setScheduleKind(kind: string) {
    if (!editing) return;
    if (kind === 'manual') editing.schedule = { kind: 'manual' };
    else if (kind === 'every') editing.schedule = { kind: 'every', hours: 4 };
    else if (kind === 'daily') editing.schedule = { kind: 'daily', time: '09:00', weekdaysOnly: true };
  }

  async function save() {
    if (!editing || saving) return;
    saving = true;
    formError = '';
    try {
      await recipesStore.save(editing);
      editing = null;
    } catch (e) {
      formError = message(e);
    } finally {
      saving = false;
    }
  }

  async function togglePaused(recipe: Recipe) {
    await recipesStore.save({ ...fieldsOf(recipe), paused: !recipe.paused }).catch((e) => store.setError(message(e)));
  }

  async function remove(id: string) {
    confirmDeleteId = null;
    await recipesStore.remove(id).catch((e) => store.setError(message(e)));
  }

  async function run(recipe: Recipe) {
    // The new thread takes the screen; the dialog would sit over it.
    if (await recipesStore.run(recipe)) close();
  }

  function close() {
    open = false;
    onclose();
  }

  function when(ts: number): string {
    return new Date(ts).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function outcomeText(recipe: Recipe): string {
    const o = recipe.lastOutcome;
    if (!o) return 'Not run yet';
    if (o.error) return `Failed ${when(o.at)}: ${o.error}`;
    if (o.skipped) return `Skipped ${when(o.at)}: ${o.skipped}`;
    return `Started a thread ${when(o.at)}`;
  }

  function agentName(id: string): string {
    return id ? agentsStore.get(id)?.displayName ?? id : 'Default agent';
  }
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) close(); }}>
  <Dialog.Content class="sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Recipes · {store.repoDisplayName(repoPath)}</Dialog.Title>
      <Dialog.Description>
        Start a thread with a set agent, mode and first message, by hand or on a schedule. Schedules run only while Grove Bench is open.
      </Dialog.Description>
    </Dialog.Header>

    {#if editing}
      <div class="flex flex-col gap-3 mt-2">
        <div>
          <Label for="recipe-name" class="mb-1 block">Name</Label>
          <!-- svelte-ignore a11y_autofocus -->
          <Input id="recipe-name" bind:value={editing.name} placeholder="Work the next Linear issue" autofocus />
        </div>

        <div class="flex flex-wrap items-end gap-3">
          <div class="flex flex-col gap-1">
            <Label for="recipe-agent">Agent</Label>
            <Select.Root type="single" value={editing.agentId || DEFAULT} onValueChange={(v) => { if (editing) editing.agentId = !v || v === DEFAULT ? '' : v; }}>
              <Select.Trigger id="recipe-agent" class="w-44">{agentName(editing.agentId)}</Select.Trigger>
              <Select.Content>
                <Select.Item value={DEFAULT} label="Default agent" />
                {#each agents as agent (agent.id)}
                  <Select.Item value={agent.id} label={agent.displayName} />
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
          <div class="flex flex-col gap-1">
            <Label for="recipe-mode">Mode</Label>
            <Select.Root type="single" value={editing.permissionMode || DEFAULT} onValueChange={(v) => { if (editing) editing.permissionMode = !v || v === DEFAULT ? '' : v as PermissionMode; }}>
              <Select.Trigger id="recipe-mode" class="w-36">{MODES.find((m) => m.value === (editing?.permissionMode || DEFAULT))?.label}</Select.Trigger>
              <Select.Content>
                {#each MODES as mode (mode.value)}
                  <Select.Item value={mode.value} label={mode.label} />
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
          {#if !folderProject}
            <div class="flex flex-col gap-1">
              <Label>Runs in</Label>
              <Segmented.Root
                value={editing.start}
                onValueChange={(v) => { if (editing && (v === 'new' || v === 'folder')) editing.start = v; }}
                aria-label="Runs in"
                class="h-9"
              >
                <Segmented.Item value="new" title="Each run gets its own branch and worktree">New branch</Segmented.Item>
                <Segmented.Item value="folder" title="Runs in the project folder, on whatever is checked out">Project folder</Segmented.Item>
              </Segmented.Root>
            </div>
          {/if}
        </div>

        <div>
          <Label for="recipe-skill" class="mb-1 block">Skill <span class="text-muted-foreground font-normal">(optional)</span></Label>
          <Input id="recipe-skill" bind:value={editing.skill} placeholder="work-linear-issue" />
        </div>

        <div>
          <Label for="recipe-prompt" class="mb-1 block">First message</Label>
          <Textarea
            id="recipe-prompt"
            bind:value={editing.prompt}
            rows={5}
            placeholder="Take the top Linear issue labelled agent-ready, move it to In Progress, fix it and open a PR."
          />
        </div>

        <div class="flex flex-col gap-2">
          <Label>Schedule</Label>
          <div class="flex flex-wrap items-center gap-3">
            <Segmented.Root value={editing.schedule.kind} onValueChange={(v) => { if (v) setScheduleKind(v); }} aria-label="Schedule" class="h-9">
              <Segmented.Item value="manual">By hand</Segmented.Item>
              <Segmented.Item value="every">Every</Segmented.Item>
              <Segmented.Item value="daily">Daily</Segmented.Item>
            </Segmented.Root>
            {#if editing.schedule.kind === 'every'}
              <div class="flex items-center gap-1.5">
                <Input type="number" min="1" max="168" class="w-20" aria-label="Hours between runs" bind:value={editing.schedule.hours} />
                <span class="text-xs text-muted-foreground">hours</span>
              </div>
            {:else if editing.schedule.kind === 'daily'}
              <Input type="time" class="w-28" aria-label="Time of day" bind:value={editing.schedule.time} />
              <label class="flex items-center gap-1.5 text-xs">
                <Checkbox bind:checked={editing.schedule.weekdaysOnly} />
                Weekdays only
              </label>
            {/if}
          </div>
          {#if editing.schedule.kind !== 'manual'}
            <div class="flex items-center gap-1.5">
              <span class="text-xs text-muted-foreground">Skip a run while</span>
              <Input type="number" min="1" max={MAX_OPEN_LIMIT} class="w-16" aria-label="Open threads before a run is skipped" bind:value={editing.maxOpen} />
              <span class="text-xs text-muted-foreground">of its threads are still open</span>
            </div>
          {/if}
        </div>

        {#if formError}
          <Notice tone="danger"><p>{formError}</p></Notice>
        {/if}
      </div>

      <Dialog.Footer>
        <Button variant="subtle" size="sm" onclick={() => { editing = null; }}>Back</Button>
        <Button size="sm" disabled={saving || !editing.name.trim()} onclick={save}>Save</Button>
      </Dialog.Footer>
    {:else}
      <div class="flex flex-col gap-2 mt-2">
        {#each recipes as recipe (recipe.id)}
          {@const next = recipeNextRun(recipe)}
          {@const openCount = recipesStore.openThreads(recipe)}
          <div class="border border-border px-3 py-2 flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate">{recipe.name}</div>
              <div class="text-caption text-muted-foreground">
                {describeSchedule(recipe.schedule)}{recipe.paused && recipe.schedule.kind !== 'manual' ? ' · paused' : ''}
                · {agentName(recipe.agentId)}{recipe.skill ? ` · ${recipe.skill}` : ''}
              </div>
              {#if next}
                <div class="text-caption text-muted-foreground">Next run {when(next)}</div>
              {/if}
              <div class="text-caption text-muted-foreground">
                {outcomeText(recipe)}{openCount ? ` · ${openCount} open` : ''}
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <Button size="xs" variant="secondary" disabled={!!recipesStore.starting[recipe.id]} onclick={() => run(recipe)}>Run</Button>
              {#if recipe.schedule.kind !== 'manual'}
                <Button size="xs" variant="subtle" onclick={() => togglePaused(recipe)}>{recipe.paused ? 'Resume' : 'Pause'}</Button>
              {/if}
              <Button size="xs" variant="subtle" onclick={() => edit(recipe)}>Edit</Button>
              {#if confirmDeleteId === recipe.id}
                <Button size="xs" variant="destructive" onclick={() => remove(recipe.id)}>Delete</Button>
              {:else}
                <Button
                  size="icon-xs"
                  variant="quiet-destructive"
                  onclick={() => { confirmDeleteId = recipe.id; }}
                  title="Delete recipe"
                  aria-label="Delete recipe {recipe.name}"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </Button>
              {/if}
            </div>
          </div>
        {:else}
          <p class="text-xs text-muted-foreground">No recipes in this project yet.</p>
        {/each}
      </div>

      <Dialog.Footer>
        <Button variant="subtle" size="sm" onclick={close}>Close</Button>
        <Button size="sm" onclick={() => edit(null)}>New recipe</Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
