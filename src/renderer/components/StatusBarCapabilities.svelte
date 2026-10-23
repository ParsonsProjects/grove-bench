<script lang="ts">
  /**
   * MCP servers over skills, as one stack, so both popovers open above the
   * pair rather than over each other. A narrow bar drops the stack to keep
   * the branch in view, unless an MCP server is down: that is worth the room.
   */
  import StatusBarMcp from './StatusBarMcp.svelte';
  import StatusBarSkills from './StatusBarSkills.svelte';

  let { sessionId }: { sessionId: string } = $props();

  let mcpCount = $state(0);
  let mcpHealth = $state<'ok' | 'partial' | 'down'>('ok');
  let skillCount = $state(0);
  let display = $derived(
    mcpCount === 0 && skillCount === 0 ? 'hidden' : mcpHealth === 'ok' ? 'hidden @2xl:flex' : 'flex',
  );
</script>

<div class="relative {display} flex-col gap-px leading-snug">
  <StatusBarMcp {sessionId} bind:count={mcpCount} bind:health={mcpHealth} />
  <StatusBarSkills {sessionId} bind:count={skillCount} />
</div>
