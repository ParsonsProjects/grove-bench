<script lang="ts">
  import { terminal } from '../actions/terminal.js';

  let { sessionId }: { sessionId: string } = $props();
</script>

<div class="terminal-container w-full h-full" use:terminal={sessionId}></div>

<style>
  .terminal-container {
    min-height: 100px;
    background: #0a0a0a;
  }
  .terminal-container :global(.xterm) {
    height: 100%;
    padding: 4px;
  }
</style>
