<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { terminalStore } from '../stores/terminal.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { collectTailLines, formatTerminalContext, DEFAULT_TAIL_LINES } from '$lib/terminal-context.js';
  import { openLink } from '$lib/preview-links.js';
  import { terminalColors, prefersLight, onColorSchemeChange } from '$lib/terminal-theme.js';
  import { FONTS } from '../../shared/brand.js';
  import { PanelHeader } from '$lib/components/ui/panel-header/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';

  let { sessionId }: { sessionId: string } = $props();

  let containerEl: HTMLDivElement;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let resizeObserver: ResizeObserver | null = null;
  // Recolour the terminal when the Theme setting or Windows switches theme.
  let colors = $state.raw(terminalColors(prefersLight()));
  const stopSchemeListener = onColorSchemeChange((light) => {
    colors = terminalColors(light);
    if (terminal) {
      terminal.options.theme = colors.theme;
      terminal.options.minimumContrastRatio = colors.minimumContrastRatio;
    }
  });

  let isAlive = $derived(terminalStore.isAlive(sessionId));

  function createTerminal() {
    if (!containerEl) return;

    terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      // The app's own face, bundled (styles/fonts.ts). The window is drawn
      // in it before any terminal opens, so xterm measures the loaded font.
      fontFamily: FONTS.mono,
      ...colors,
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
  <PanelHeader>
    <span class="text-micro text-muted-foreground flex items-center gap-1.5">
      {#if isAlive}
        <Pulse size="xs" motion="none" />
        Running
      {:else}
        <Pulse tone="muted" size="xs" motion="none" />
        Stopped
      {/if}
    </span>
    {#snippet actions()}
      <Button
        size="2xs"
        variant="subtle"
        onclick={handleAttachToPrompt}
        title="Attach the selected text (or the last {DEFAULT_TAIL_LINES} lines of output) to the next message"
      >
        To prompt
      </Button>
      {#if isAlive}
        <Button size="2xs" variant="outline-destructive" onclick={handleKill} title="Kill terminal process">
          Kill
        </Button>
      {/if}
      <Button size="2xs" variant="subtle" onclick={handleRestart} title="Restart terminal">
        Restart
      </Button>
      <Button size="2xs" variant="subtle" onclick={handleClear} title="Clear terminal output">
        Clear
      </Button>
    {/snippet}
  </PanelHeader>

  <!-- xterm.js container -->
  <div
    class="flex-1 overflow-hidden"
    bind:this={containerEl}
    style="background: {colors.theme.background};"
  ></div>
</div>
