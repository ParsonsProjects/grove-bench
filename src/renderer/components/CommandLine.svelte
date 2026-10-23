<script lang="ts">
  /**
   * A command for the user to run in their own terminal, with a copy button.
   * Grove never runs these (installs, sign-ins): the user sees and runs them.
   */
  import CopyButton from './CopyButton.svelte';

  let { command, label }: { command: string; label?: string } = $props();
</script>

<div class="flex items-center gap-2 border border-border bg-muted/30 pl-2 pr-0.5 py-0.5" role="group" aria-label={label ?? command}>
  <code class="flex-1 min-w-0 truncate font-mono text-xs text-foreground" title={command}>{command}</code>
  <CopyButton text={command} />
</div>
