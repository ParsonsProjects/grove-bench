<script lang="ts">
  /**
   * Skills, along the foot of the new thread's message box (DraftStatusBar):
   * the draft agent's skills in its project. Picking one starts the message
   * with "Use the `x` skill for this task.", as / in the message box does,
   * for any agent. Shows the skill the message asks for, once there is one.
   */
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import { draftStore } from '../stores/draft.svelte.js';
  import { splitSkillLine } from '../../shared/skill-line.js';
  import { menuItem, menuLabel, menuPanel, menuSeparator } from '$lib/components/ui/menu/index.js';
  import { placeInPane } from '../lib/keep-in-viewport.js';
  import { draftPrototype } from '$lib/draft-prototype.svelte.js';
  import { cn } from '$lib/utils.js';

  /** After a pick, so the message box can take the cursor back. */
  let { onpick }: { onpick?: () => void } = $props();

  let open = $state(false);
  let ref = $state<HTMLDivElement | null>(null);

  const skills = $derived(draftStore.skills);
  const chosen = $derived(splitSkillLine(draftStore.draft?.text ?? '')?.skill ?? null);
  /** Prototype 'compact' footer: the count and a long name give way first. */
  const compact = $derived(draftPrototype.current.footer === 'compact');

  function toggle() {
    open = !open;
    if (open) void draftStore.loadSkills();
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
  <span class={cn('w-px self-stretch bg-border', compact && !chosen && '@max-md:hidden')}></span>
  <!-- 'compact', narrow: a skill not picked yet is left to / in the box. -->
  <div class={cn('relative flex flex-col gap-px leading-snug min-w-0', compact && !chosen && '@max-md:hidden')} bind:this={ref}>
    <button
      type="button"
      onclick={toggle}
      class="flex items-center gap-1 min-w-0 text-left transition-colors {chosen ? 'text-foreground/80 hover:text-foreground' : 'text-muted-foreground hover:text-foreground'}"
      title={chosen ? `The message starts by asking for the ${chosen} skill. Click to change it` : 'Start the message with one of the agent\'s skills (or type / in the message box)'}
      aria-haspopup="menu"
      aria-expanded={open}
    >
      {#if chosen}
        <span class={cn('text-muted-foreground shrink-0', compact && '@max-md:hidden')}>Skill</span>
        <span class={cn('font-mono truncate max-w-40 border-b border-dashed border-muted-foreground/40', compact && '@max-md:max-w-20')}>{chosen}</span>
      {:else}
        <span class="border-b border-dashed border-muted-foreground/40">Skills</span>
        <span class="text-caption">{skills.length}</span>
      {/if}
    </button>

    {#if open}
      <div
        transition:fade={{ duration: 120 }}
        use:placeInPane
        class="{menuPanel()} absolute top-full left-0 mt-2 z-50 w-80 max-h-72 overflow-y-auto"
        role="menu"
        aria-label="Skills"
      >
        <div class={menuLabel}>Start with a skill</div>
        {#each skills as skill (skill.name)}
          <button
            type="button"
            role="menuitem"
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
