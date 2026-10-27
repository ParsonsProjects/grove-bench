<script lang="ts">
  /**
   * Skills, along the foot of the new thread's message box (DraftStatusBar):
   * the draft agent's skills in its project. Picking one starts the message
   * with "Use the `x` skill for this task.", as / in the message box does,
   * for any agent. Shows the skill the message asks for, once there is one.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { draftStore } from '../stores/draft.svelte.js';
  import { splitSkillLine } from '../../shared/skill-line.js';
  import { menuItem, menuLabel, menuPanel, menuSeparator } from '$lib/components/ui/menu/index.js';
  import { placeInPane } from '../lib/keep-in-viewport.js';

  /** After a pick, so the message box can take the cursor back. */
  let { onpick }: { onpick?: () => void } = $props();

  let open = $state(false);
  let ref = $state<HTMLDivElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let menu = $state<HTMLDivElement | null>(null);

  const skills = $derived(draftStore.skills);
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

{#if skills.length > 0 || chosen}
  <span class="w-px self-stretch bg-border"></span>
  <div class="relative flex flex-col gap-px leading-snug min-w-0" bind:this={ref}>
    <button
      bind:this={trigger}
      type="button"
      onclick={toggle}
      class="flex items-center gap-1 min-w-0 text-left transition-colors {chosen ? 'text-foreground/80 hover:text-foreground' : 'text-muted-foreground hover:text-foreground'}"
      title={chosen ? `The message starts by asking for the ${chosen} skill. Click to change it` : 'Start the message with one of the agent\'s skills (or type / in the message box)'}
      aria-haspopup="menu"
      aria-expanded={open}
    >
      {#if chosen}
        <span class="text-muted-foreground shrink-0">Skill</span>
        <span class="font-mono truncate max-w-40 border-b border-dashed border-muted-foreground/40">{chosen}</span>
      {:else}
        <span class="border-b border-dashed border-muted-foreground/40">Skills</span>
        <span class="text-caption">{skills.length}</span>
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
        <div class={menuLabel}>Start with a skill</div>
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
          <p class="px-2 py-1 text-muted-foreground">This agent has no skills in this project.</p>
        {/each}
        {#if chosen}
          <div class={menuSeparator}></div>
          <button type="button" role="menuitem" onclick={() => pick(null)} class={menuItem()}>No skill</button>
        {/if}
      </div>
    {/if}
  </div>
{/if}
