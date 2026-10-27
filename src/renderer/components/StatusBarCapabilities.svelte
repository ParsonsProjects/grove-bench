<script lang="ts">
  /**
   * The MCP · Skills lozenge: both counts and one dot, the MCP servers'
   * health when the agent has any (green, amber when some are down, red
   * when none are connected), else whether any skill is on. A click opens a
   * menu with a row for each, which opens its drawer on the right. In a
   * narrow bar it shrinks to its dot. StatusBarMcp and StatusBarSkills stay
   * mounted beside it: they hold the counts and the MCP drawer, whose
   * sign-ins must outlive the menu.
   */
  import StatusBarMcp from './StatusBarMcp.svelte';
  import StatusBarSkills from './StatusBarSkills.svelte';
  import StatusBarPopover from './StatusBarPopover.svelte';
  import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';
  import { lozenge } from '../lib/lozenge.js';
  import { menuItem } from '$lib/components/ui/menu/index.js';

  let { sessionId }: { sessionId: string } = $props();

  let mcpCount = $state(0);
  let mcpConnected = $state(0);
  let mcpHealth = $state<'ok' | 'partial' | 'down'>('ok');
  let mcpDrawerOpen = $state(false);
  let skillCount = $state(0);
  let skillsOn = $state(0);
  let skillSuggestions = $state(0);
  let open = $state(false);

  const HEALTH_DOT = { ok: 'bg-green-500', partial: 'bg-amber-500', down: 'bg-red-500' } as const;
  /** Turning skills off is a choice, not a fault: grey with none on. */
  let skillsDot = $derived(skillsOn === 0 ? 'bg-muted-foreground/40' : 'bg-green-500');
  let dot = $derived(mcpCount > 0 ? HEALTH_DOT[mcpHealth] : skillsDot);

  let mcpText = $derived(mcpHealth === 'ok' ? `MCP ${mcpCount}` : `MCP ${mcpConnected}/${mcpCount}`);
  let skillsText = $derived(skillsOn < skillCount ? `Skills ${skillsOn}/${skillCount}` : `Skills ${skillCount}`);
  let mcpStatus = $derived(
    mcpHealth === 'ok' ? `${mcpCount} connected` : mcpHealth === 'down' ? 'none connected' : `${mcpConnected} of ${mcpCount} connected`,
  );
  let label = $derived(
    [mcpCount > 0 && `MCP servers: ${mcpStatus}`, skillCount > 0 && `Skills: ${skillsOn} of ${skillCount} on`].filter(Boolean).join(', '),
  );

  function openMcp() {
    open = false;
    mcpDrawerOpen = true;
  }

  function openSkills() {
    open = false;
    skillsPanelStore.showThread();
  }
</script>

<StatusBarMcp {sessionId} bind:count={mcpCount} bind:health={mcpHealth} bind:connected={mcpConnected} bind:drawerOpen={mcpDrawerOpen} />
<StatusBarSkills {sessionId} bind:count={skillCount} bind:enabled={skillsOn} bind:suggestions={skillSuggestions} />

{#if mcpCount > 0 || skillCount > 0}
  <StatusBarPopover bind:open align="right" surface="list" panelClass="w-64" label="MCP and Skills">
    {#snippet trigger()}
      <button
        onclick={() => (open = !open)}
        class={lozenge({ open, class: mcpHealth === 'ok' ? '' : mcpHealth === 'down' ? 'text-red-400' : 'text-amber-500' })}
        title="{label}. Click to manage them"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="capabilities"
      >
        <span class="size-1.5 shrink-0 {dot}"></span>
        <!-- A narrow bar keeps only the dot: the tooltip and the menu say the rest. -->
        <span class="hidden @3xl:inline">
          {#if mcpCount > 0}{mcpText}{/if}{#if mcpCount > 0 && skillCount > 0}<span class="px-1 text-muted-foreground/40">·</span>{/if}{#if skillCount > 0}{skillsText}{/if}
        </span>
      </button>
    {/snippet}

    {#if mcpCount > 0}
      <button onclick={openMcp} class={menuItem({ class: 'justify-between' })} title="Manage this thread's MCP server connections">
        <span class="flex items-center gap-2"><span class="size-1.5 shrink-0 {HEALTH_DOT[mcpHealth]}"></span>MCP servers</span>
        <span class={mcpHealth === 'ok' ? 'text-muted-foreground' : mcpHealth === 'down' ? 'text-red-400' : 'text-amber-500'}>{mcpStatus}</span>
      </button>
    {/if}
    {#if skillCount > 0}
      <button onclick={openSkills} class={menuItem({ class: 'justify-between' })} title="Run, schedule or manage skills">
        <span class="flex items-center gap-2"><span class="size-1.5 shrink-0 {skillsDot}"></span>Skills</span>
        <span class="text-muted-foreground">
          {skillsOn} of {skillCount} on
          {#if skillSuggestions > 0}<span class="text-blue-400" title="{skillSuggestions} suggested skill{skillSuggestions === 1 ? '' : 's'} from your threads">, +{skillSuggestions} suggested</span>{/if}
        </span>
      </button>
    {/if}
  </StatusBarPopover>
{/if}
