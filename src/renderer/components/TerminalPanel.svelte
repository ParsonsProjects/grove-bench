<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { terminalStore } from '../stores/terminal.svelte.js';

  let { sessionId }: { sessionId: string } = $props();

  let inputValue = $state('');
  let scrollContainer: HTMLDivElement;
  let inputEl: HTMLInputElement;
  let shouldAutoScroll = $state(true);

  let lines = $derived(terminalStore.getLines(sessionId));
  let isRunning = $derived(terminalStore.getIsRunning(sessionId));

  // Command history
  let history = $state<string[]>([]);
  let historyIndex = $state(-1);

  // Auto-scroll when new lines arrive
  $effect(() => {
    const _len = lines.length;
    if (shouldAutoScroll && scrollContainer) {
      requestAnimationFrame(() => {
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      });
    }
  });

  function handleScroll() {
    if (!scrollContainer) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    shouldAutoScroll = scrollHeight - scrollTop - clientHeight < 50;
  }

  function handleSubmit() {
    const cmd = inputValue.trim();
    if (!cmd) return;
    history = [...history, cmd];
    historyIndex = -1;
    inputValue = '';
    terminalStore.startCommand(sessionId, cmd);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.ctrlKey && e.key === 'c') {
      e.preventDefault();
      if (isRunning) {
        terminalStore.killActive(sessionId);
      } else {
        inputValue = '';
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIdx = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
        historyIndex = newIdx;
        inputValue = history[newIdx] ?? '';
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex >= 0) {
        const newIdx = historyIndex + 1;
        if (newIdx >= history.length) {
          historyIndex = -1;
          inputValue = '';
        } else {
          historyIndex = newIdx;
          inputValue = history[newIdx] ?? '';
        }
      }
    }
  }

  onMount(() => {
    terminalStore.subscribe(sessionId);
    inputEl?.focus();
  });

  onDestroy(() => {
    terminalStore.unsubscribe(sessionId);
  });
</script>

<div class="flex flex-col h-full">
  <!-- Output area -->
  <div
    class="flex-1 overflow-y-auto bg-card font-mono text-xs p-3 select-text"
    bind:this={scrollContainer}
    onscroll={handleScroll}
  >
    {#if lines.length === 0}
      <div class="text-muted-foreground/50 text-center py-8">
        <p>Terminal ready. Type a command below or use <code class="text-primary">!</code> prefix in the prompt.</p>
        <p class="mt-1 text-[10px]">Ctrl+C to kill running process</p>
      </div>
    {/if}

    {#each lines as line (line.id)}
      <div class="leading-5 whitespace-pre-wrap break-all {
        line.stream === 'stderr'
          ? 'text-red-400'
          : line.stream === 'system'
            ? 'text-muted-foreground'
            : 'text-foreground'
      }">{line.text}</div>
    {/each}
  </div>

  <!-- Input row -->
  <div class="border-t border-border flex items-center gap-2 px-3 py-2 shrink-0 bg-background">
    <span class="text-muted-foreground font-mono text-sm shrink-0">$</span>
    <input
      bind:this={inputEl}
      bind:value={inputValue}
      onkeydown={handleKeydown}
      placeholder={isRunning ? 'Running... (Ctrl+C to kill)' : 'Enter command...'}
      class="flex-1 bg-transparent text-sm text-foreground font-mono
        placeholder:text-muted-foreground focus:outline-none"
    />
    {#if isRunning}
      <button
        onclick={() => terminalStore.killActive(sessionId)}
        class="text-[10px] px-2 py-0.5 border border-destructive text-destructive hover:bg-destructive/10 transition-colors shrink-0"
        title="Kill process (Ctrl+C)"
      >
        Kill
      </button>
    {/if}
    <button
      onclick={() => terminalStore.clearOutput(sessionId)}
      class="text-[10px] px-2 py-0.5 border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors shrink-0"
      title="Clear terminal output"
    >
      Clear
    </button>
  </div>
</div>
