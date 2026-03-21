<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { terminalStore } from '../stores/terminal.svelte.js';

  let { sessionId }: { sessionId: string } = $props();

  let containerEl: HTMLDivElement;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let resizeObserver: ResizeObserver | null = null;

  let isAlive = $derived(terminalStore.isAlive(sessionId));

  function createTerminal() {
    if (!containerEl) return;

    terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      theme: {
        background: '#1f1f1f',
        foreground: '#cccccc',
        cursor: '#cccccc',
        selectionBackground: '#04395e',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
      allowProposedApi: true,
      scrollback: 10000,
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      window.groveBench.openExternal(uri);
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
    const alive = await terminalStore.checkAlive(sessionId);
    if (!alive) {
      await terminalStore.spawn(sessionId);
      // After spawning, send initial resize
      if (terminal) {
        terminalStore.resize(sessionId, terminal.cols, terminal.rows);
      }
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

  onMount(async () => {
    terminalStore.subscribe(sessionId);
    createTerminal();
    await ensurePty();
  });

  onDestroy(() => {
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
    style="background: #1f1f1f;"
  ></div>
</div>
