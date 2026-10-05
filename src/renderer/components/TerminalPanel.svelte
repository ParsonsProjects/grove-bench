<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { terminalStore } from '../stores/terminal.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { collectTailLines, formatTerminalContext, DEFAULT_TAIL_LINES } from '$lib/terminal-context.js';
  import { openLink } from '$lib/preview-links.js';
  import { terminalTheme, prefersLight, onColorSchemeChange } from '$lib/terminal-theme.js';

  let { sessionId }: { sessionId: string } = $props();

  let containerEl: HTMLDivElement;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let resizeObserver: ResizeObserver | null = null;
  // Recolour the terminal when the Theme setting or Windows switches theme.
  const stopSchemeListener = onColorSchemeChange((light) => {
    if (terminal) terminal.options.theme = terminalTheme(light);
  });

  let isAlive = $derived(terminalStore.isAlive(sessionId));

  function createTerminal() {
    if (!containerEl) return;

    terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      theme: terminalTheme(prefersLight()),
      allowProposedApi: true,
      scrollback: 10000,
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    const webLinksAddon = new WebLinksAddon((event, uri) => {
      openLink(uri, event);
    });
    terminal.loadAddon(webLinksAddon);

    terminal.open(containerEl);

    // Fit after open (need a frame for dimensions to settle)
    requestAnimationFrame(() => {
      fitAddon?.fit();
    });

    // Forward keystrokes to PTY
    terminal.onData((data) => {
      terminalStore.write(sessionId, data);
    });

    // Watch for container resizes
    resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (fitAddon && terminal) {
          fitAddon.fit();
          terminalStore.resize(sessionId, terminal.cols, terminal.rows);
        }
      });
    });
    resizeObserver.observe(containerEl);

    // Register data handler to write PTY output to xterm
    terminalStore.onData(sessionId, (data) => {
      terminal?.write(data);
    });

    // Register exit handler
    terminalStore.onExit(sessionId, (exitCode, signal) => {
      terminal?.write(`\r\n\x1b[90m[Process exited with code ${exitCode}${signal ? `, signal ${signal}` : ''}]\x1b[0m\r\n`);
    });
  }

  async function ensurePty() {
    const wasAlive = terminalStore.isAlive(sessionId);
    const ok = await terminalStore.ensureAlive(sessionId);
    if (ok && !wasAlive && terminal) {
      // Freshly spawned (or first seen): send the current dimensions
      terminalStore.resize(sessionId, terminal.cols, terminal.rows);
    }
  }

  async function handleRestart() {
    terminal?.clear();
    const ok = await terminalStore.restart(sessionId);
    if (ok && terminal) {
      terminalStore.resize(sessionId, terminal.cols, terminal.rows);
    }
  }

  async function handleKill() {
    await terminalStore.kill(sessionId);
  }

  function handleClear() {
    terminal?.clear();
  }

  /** Attach the terminal selection (or the tail of the scrollback) to the
   *  prompt as fenced context, and jump to the Activity tab to send it. */
  function handleAttachToPrompt() {
    if (!terminal) return;
    const selection = terminal.getSelection();
    const selected = selection.trim().length > 0;
    const raw = selected ? selection : collectTailLines(terminal.buffer.active, DEFAULT_TAIL_LINES).join('\n');
    const context = formatTerminalContext(raw, { selected });
    if (!context) return;
    // The prompt editor is not mounted while the Terminal tab is showing, so
    // go through the draft as well as the live insert request.
    messageStore.appendToPrompt(sessionId, context);
    messageStore.setActiveTab(sessionId, 'activity');
  }

  onMount(async () => {
    terminalStore.subscribe(sessionId);
    createTerminal();
    await ensurePty();
  });

  onDestroy(() => {
    stopSchemeListener();
    resizeObserver?.disconnect();
    resizeObserver = null;
    terminal?.dispose();
    terminal = null;
    fitAddon = null;
    terminalStore.unsubscribe(sessionId);
  });
</script>

<div class="flex flex-col h-full">
  <!-- Terminal toolbar -->
  <div class="border-b border-border flex items-center gap-2 px-3 py-1 shrink-0 bg-card/50">
    <span class="text-[10px] text-muted-foreground flex items-center gap-1.5">
      {#if isAlive}
        <span class="inline-block w-1.5 h-1.5 bg-green-500"></span>
        Running
      {:else}
        <span class="inline-block w-1.5 h-1.5 bg-muted-foreground/50"></span>
        Stopped
      {/if}
    </span>
    <div class="flex-1"></div>
    <button
      onclick={handleAttachToPrompt}
      class="text-[10px] px-2 py-0.5 border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors"
      title="Attach the selected text (or the last {DEFAULT_TAIL_LINES} lines of output) to the next message"
    >
      To prompt
    </button>
    {#if isAlive}
      <button
        onclick={handleKill}
        class="text-[10px] px-2 py-0.5 border border-destructive text-destructive hover:bg-destructive/10 transition-colors"
        title="Kill terminal process"
      >
        Kill
      </button>
    {/if}
    <button
      onclick={handleRestart}
      class="text-[10px] px-2 py-0.5 border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors"
      title="Restart terminal"
    >
      Restart
    </button>
    <button
      onclick={handleClear}
      class="text-[10px] px-2 py-0.5 border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors"
      title="Clear terminal output"
    >
      Clear
    </button>
  </div>

  <!-- xterm.js container -->
  <div
    class="flex-1 overflow-hidden"
    bind:this={containerEl}
    style="background: var(--background);"
  ></div>
</div>
