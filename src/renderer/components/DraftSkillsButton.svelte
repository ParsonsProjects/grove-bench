<script lang="ts">
  /**
   * Skills, along the foot of the new thread's message box (DraftStatusBar):
   * the draft agent's skills in its project. Picking one starts the message
   * with "Use the `x` skill for this task.", as / in the message box does,
   * for any agent. Shows the skill the message asks for, once there is one.
   * It holds its place from the start, with a loading square until the
   * first list arrives, so the row doesn't shift when it does; with no
   * skills it stays, at 0, for the same reason.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { draftStore } from '../stores/draft.svelte.js';
  import { splitSkillLine } from '../../shared/skill-line.js';
  import { menuItem, menuLabel, menuPanel, menuSeparator } from '$lib/components/ui/menu/index.js';
  import { placeInPane } from '../lib/keep-in-viewport.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';

  /** After a pick, so the message box can take the cursor back. */
  let { onpick }: { onpick?: () => void } = $props();

  let open = $state(false);
  let ref = $state<HTMLDivElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let menu = $state<HTMLDivElement | null>(null);

  const skills = $derived(draftStore.skills);
  /** Looking for skills with none to show yet: the first list for this
   *  agent and project. Once there is one, it shows while a fresh one loads. */
  const looking = $derived(draftStore.skillsLoading && skills.length === 0);
  const hasAgent = $derived(!!draftStore.draft?.agentId);
  const chosen = $derived(splitSkillLine(draftStore.draft?.text ?? '')?.skill ?? null);

  function toggle() {
    open = !open;
    if (open) {
      void draftStore.loadSkills();
      // Focus goes into the menu, on the skill asked for or the first.
      void tick().then(() => (menu?.querySelector<HTMLElement>('[aria-checked="true"]') ?? items()[0])?.focus());
    }
  }

  function items(): HTMLElement[] {
    return [...(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
  }

  /** Up and Down move between the menu's items, Home and End to either
   *  end, as in any menu. */
  function moveFocus(e: KeyboardEvent) {
    const list = items();
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % list.length
      : e.key === 'ArrowUp' ? (at <= 0 ? list.length - 1 : at - 1)
        : e.key === 'Home' ? 0
          : e.key === 'End' ? list.length - 1
            : null;
    if (next === null) return;
    e.preventDefault();
    list[next].focus();
  }

  function pick(skill: string | null) {
    draftStore.useSkill(skill);
    open = false;
    onpick?.();
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as Node;
    if (open && ref && target.isConnected && !ref.contains(target)) open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') {
      e.stopPropagation();
      // Back to the button, if focus was in the menu.
      if (ref?.contains(document.activeElement)) trigger?.focus();
      open = false;
    }
  }

  onMount(() => {
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleKeydown, true);
  });

  onDestroy(() => {
    window.removeEventListener('click', handleClickOutside);
    window.removeEventListener('keydown', handleKeydown, true);
  });
</script>

{#if hasAgent || chosen}
  <span class="w-px self-stretch bg-border"></span>
  <div class="relative flex flex-col gap-px leading-snug min-w-0" bind:this={ref}>
    <button
      bind:this={trigger}
      type="button"
      onclick={toggle}
      class="flex items-center gap-1 min-w-0 text-left transition-colors {chosen ? 'text-foreground/80 hover:text-foreground' : skills.length > 0 || looking ? 'text-muted-foreground hover:text-foreground' : 'text-muted-foreground/60 hover:text-foreground'}"
      title={chosen ? `The message starts by asking for the ${chosen} skill. Click to change it`
        : looking ? 'Looking for the agent\'s skills in this project'
          : skills.length > 0 ? 'Start the message with one of the agent\'s skills (or type / in the message box)'
            : 'The agent has no skills in this project'}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-busy={looking || undefined}
    >
      {#if chosen}
        <span class="text-muted-foreground shrink-0">Skill</span>
        <span class="font-mono truncate max-w-40 border-b border-dashed border-muted-foreground/40">{chosen}</span>
      {:else}
        <span class="border-b border-dashed border-muted-foreground/40">Skills</span>
        <!-- The square takes the count's place, so the row keeps its width. -->
        <span class="text-caption inline-flex justify-center min-w-[1ch]">
          {#if looking}<Pulse size="xs" label="Loading" />{:else}{skills.length}{/if}
        </span>
      {/if}
    </button>

    {#if open}
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <div
        bind:this={menu}
        transition:fade={{ duration: 120 }}
        use:placeInPane
        class="{menuPanel()} absolute top-full left-0 mt-2 z-50 w-80 max-h-72 overflow-y-auto"
        role="menu"
        aria-label="Skills"
        onkeydown={moveFocus}
      >
        <div class="{menuLabel} flex items-center justify-between gap-2">
          Start with a skill
          {#if draftStore.skillsLoading && !looking}<Pulse size="xs" label="Checking for new skills" />{/if}
        </div>
        {#each skills as skill (skill.name)}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={skill.name === chosen}
            onclick={() => pick(skill.name)}
            class={menuItem({ selected: skill.name === chosen })}
            title={skill.description || skill.name}
          >
            <span class="flex flex-col min-w-0">
              <span class="font-mono truncate">{skill.name}</span>
              {#if skill.description}
                <span class="text-caption text-muted-foreground truncate">{skill.description}</span>
              {/if}
            </span>
          </button>
        {:else}
          {#if looking}
            <p class="flex items-center gap-2 px-2 py-1 text-muted-foreground" role="status">
              <Pulse size="xs" /> Looking for skills…
            </p>
          {:else}
            <p class="px-2 py-1 text-muted-foreground">This agent has no skills in this project.</p>
          {/if}
        {/each}
        {#if chosen}
          <div class={menuSeparator}></div>
          <button type="button" role="menuitem" onclick={() => pick(null)} class={menuItem()}>No skill</button>
        {/if}
      </div>
    {/if}
  </div>
{/if}
