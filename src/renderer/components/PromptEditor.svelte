<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { terminalStore } from '../stores/terminal.svelte.js';
  import FilePickerPopup from './FilePickerPopup.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Command from '$lib/components/ui/command/index.js';
  import {
    type AttachedFile,
    processFiles,
    extractClipboardImages,
    IMAGE_MIME_TYPES,
    TEXT_EXTENSIONS,
  } from '$lib/file-attachments.js';

  let { sessionId }: { sessionId: string } = $props();

  let value = $state('');
  let textarea: HTMLTextAreaElement;

  // Restore draft on mount (sessionId is stable per instance)
  onMount(() => {
    value = messageStore.getDraft(sessionId);
  });

  // Sync draft to store whenever value changes
  $effect(() => {
    messageStore.setDraft(sessionId, value);
  });

  // Auto-resize textarea when mounting with a restored draft
  $effect(() => {
    if (textarea && value) {
      autoResize();
    }
  });
  let userResized = $state(false);
  let pickerOpen = $state(false);
  let pickerQuery = $state('');
  let atStartIndex = $state(-1);
  let pickerRef: FilePickerPopup | undefined = $state();

  // File attachments (drag-drop, paste, file picker)
  let attachedFiles = $state<AttachedFile[]>([]);
  let dragOver = $state(false);
  let dropMessage = $state<{ text: string; isError: boolean } | null>(null);
  let dropMessageTimer: ReturnType<typeof setTimeout> | undefined;

  // Slash command autocomplete
  let commandPickerOpen = $state(false);
  let commandQuery = $state('');
  let commandSelectedIndex = $state(0);

  const builtinCommands = [
    { name: '/compact', description: 'Compact conversation to free context space' },
    { name: '/clear', description: 'Clear conversation and start fresh' },
    { name: '/rewind', description: 'Rewind to a previous checkpoint' },
  ];

  // Include custom slash commands from session info
  let customCommands = $derived.by(() => {
    const info = messageStore.getSystemInfo(sessionId);
    return info.slashCommands
      .filter((c) => c !== 'compact' && c !== 'clear')
      .map((c) => ({ name: `/${c}`, description: '' }));
  });

  let allCommands = $derived([...builtinCommands, ...customCommands]);

  let filteredCommands = $derived(
    commandQuery
      ? allCommands.filter((c) => c.name.toLowerCase().includes(commandQuery.toLowerCase()))
      : allCommands,
  );

  let isRunning = $derived(messageStore.getIsRunning(sessionId));

  // The input is always usable once mounted — no need to wait for system_init.
  // The SDK's system_init can take 30+ seconds (or never arrive for the first
  // query) but messages are queued in the ReadableStream and processed once
  // the SDK connects.  Gating on system_init left worktree inputs permanently
  // disabled.
  let canSend = $derived(!isRunning);
  let promptSuggestions = $derived(messageStore.getPromptSuggestions(sessionId));

  function handleSubmit() {
    const text = value.trim();
    if (!text || !canSend) return;

    // Shell command: ! prefix runs directly in terminal
    if (text.startsWith('!')) {
      const cmd = text.slice(1).trim();
      if (cmd) {
        value = '';
        closePicker();
        closeCommandPicker();
        userResized = false;
        if (textarea) textarea.style.height = '';
        messageStore.setActiveTab(sessionId, 'terminal');
        // Ensure PTY is alive, then write the command + Enter
        (async () => {
          const alive = await terminalStore.checkAlive(sessionId);
          if (!alive) await terminalStore.spawn(sessionId);
          terminalStore.write(sessionId, cmd + '\r');
        })();
      }
      return;
    }

    // Check if it's a slash command
    if (text.startsWith('/')) {
      messageStore.sendCommand(sessionId, text);
      value = '';
      closePicker();
      closeCommandPicker();
      userResized = false;
      if (textarea) textarea.style.height = '';
      return;
    }

    const atPattern = /@([\w.\/\-]+)/g;
    const refs: string[] = [];
    let match;
    while ((match = atPattern.exec(text)) !== null) {
      refs.push(match[1]);
    }

    // Separate text files and image attachments
    const textFiles = attachedFiles.filter((f): f is AttachedFile & { type: 'text' } => f.type === 'text');
    const imageFiles = attachedFiles.filter((f): f is AttachedFile & { type: 'image' } => f.type === 'image');

    // Build file tags from text attachments
    const droppedTags = textFiles.map(
      (f) => `<file path="${f.name}">\n${f.content}\n</file>`,
    );

    // Extract base64 image data for the API
    const images = imageFiles.map((f) => {
      // dataUrl format: "data:image/png;base64,iVBOR..."
      const [header, data] = f.dataUrl.split(',');
      const mediaType = header.match(/data:(image\/\w+)/)?.[1] ?? 'image/png';
      return { data, mediaType: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', name: f.name };
    });

    const displayText = attachedFiles.length > 0
      ? `[${attachedFiles.map((f) => f.name).join(', ')}] ${text}`
      : text;

    function send(prefix: string) {
      messageStore.addUserMessage(sessionId, displayText);
      window.groveBench.sendMessage(sessionId, prefix + text, images.length > 0 ? images : undefined);
      store.updateLastActive(sessionId);
    }

    if (refs.length > 0) {
      Promise.all(
        refs.map(async (ref) => {
          try {
            const content = await window.groveBench.readFile(sessionId, ref);
            const isDir = ref.endsWith('/');
            const tag = isDir ? 'folder' : 'file';
            return `<${tag} path="${ref}">\n${content}\n</${tag}>`;
          } catch {
            const tag = ref.endsWith('/') ? 'folder' : 'file';
            return `<${tag} path="${ref}">\n(could not read)\n</${tag}>`;
          }
        })
      ).then((refTags) => {
        const allTags = [...droppedTags, ...refTags];
        const prefix = allTags.length > 0 ? allTags.join('\n') + '\n\n' : '';
        send(prefix);
      });
    } else {
      const prefix = droppedTags.length > 0 ? droppedTags.join('\n') + '\n\n' : '';
      send(prefix);
    }

    value = '';
    attachedFiles = [];
    messageStore.clearPromptSuggestions(sessionId);
    closePicker();
    closeCommandPicker();
    userResized = false;
    if (container) container.style.height = '';
    if (textarea) textarea.style.height = '';
  }

  function useSuggestion(suggestion: string) {
    value = suggestion;
    messageStore.clearPromptSuggestions(sessionId);
    textarea?.focus();
    handleInput();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (pickerOpen && pickerRef) {
      if (pickerRef.handleKeydown(e)) return;
    }

    // Command picker navigation
    if (commandPickerOpen && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        commandSelectedIndex = (commandSelectedIndex + 1) % filteredCommands.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        commandSelectedIndex = (commandSelectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const cmd = filteredCommands[commandSelectedIndex];
        if (cmd) {
          value = cmd.name + ' ';
          closeCommandPicker();
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filteredCommands[commandSelectedIndex];
        if (cmd) {
          value = cmd.name;
          closeCommandPicker();
          handleSubmit();
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCommandPicker();
        return;
      }
    } else if (commandPickerOpen && e.key === 'Escape') {
      e.preventDefault();
      closeCommandPicker();
      return;
    }

    // Ctrl+C with no selection clears the input (terminal-style)
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      const sel = window.getSelection()?.toString() || '';
      if (!sel && value.length > 0) {
        e.preventDefault();
        value = '';
        attachedFiles = [];
        closePicker();
        closeCommandPicker();
        userResized = false;
        if (container) container.style.height = '';
        if (textarea) textarea.style.height = '';
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function autoResize() {
    if (!textarea || userResized) return;
    textarea.style.height = '0';
    const scrollH = textarea.scrollHeight;
    // Cap textarea itself at 150px, let container flex naturally
    textarea.style.height = Math.min(scrollH, 150) + 'px';
  }

  function handleInput() {
    autoResize();

    // Slash command picker
    if (value.startsWith('/') && !value.includes(' ')) {
      commandPickerOpen = true;
      commandQuery = value;
      commandSelectedIndex = 0;
    } else {
      closeCommandPicker();
    }

    const pos = textarea?.selectionStart ?? 0;
    const textBefore = value.slice(0, pos);
    const atMatch = textBefore.match(/@([\w.\/\-]*)$/);

    if (atMatch) {
      pickerOpen = true;
      atStartIndex = pos - atMatch[0].length;
      pickerQuery = atMatch[1];
    } else {
      closePicker();
    }
  }

  function closePicker() {
    pickerOpen = false;
    pickerQuery = '';
    atStartIndex = -1;
  }

  function closeCommandPicker() {
    commandPickerOpen = false;
    commandQuery = '';
    commandSelectedIndex = 0;
  }

  function selectFile(path: string) {
    const before = value.slice(0, atStartIndex);
    const after = value.slice(textarea?.selectionStart ?? value.length);
    value = before + '@' + path + ' ' + after;
    closePicker();
    textarea?.focus();
  }

  function selectCommand(cmd: { name: string }) {
    value = cmd.name;
    closeCommandPicker();
    handleSubmit();
  }

  let container: HTMLDivElement;

  function handleResizeMousedown(e: MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = container.offsetHeight;

    function onMousemove(ev: MouseEvent) {
      const newHeight = Math.max(60, Math.min(startHeight - (ev.clientY - startY), window.innerHeight * 0.5));
      container.style.height = newHeight + 'px';
      userResized = true;
    }

    function onMouseup() {
      window.removeEventListener('mousemove', onMousemove);
      window.removeEventListener('mouseup', onMouseup);
    }

    window.addEventListener('mousemove', onMousemove);
    window.addEventListener('mouseup', onMouseup);
  }

  function handleStop() {
    messageStore.markSessionStopped(sessionId);
    window.groveBench.stopSession(sessionId);
  }

  // ─── Drag & Drop ───

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer?.types.includes('Files')) {
      dragOver = true;
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  function handleDragLeave(e: DragEvent) {
    // Only reset if leaving the container (not entering a child)
    const related = e.relatedTarget as HTMLElement | null;
    if (!container?.contains(related)) {
      dragOver = false;
    }
  }

  function showDropMessage(text: string, isError: boolean) {
    clearTimeout(dropMessageTimer);
    dropMessage = { text, isError };
    dropMessageTimer = setTimeout(() => { dropMessage = null; }, 3000);
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const { files: newFiles, skipped } = await processFiles(files, attachedFiles);
    if (newFiles.length > 0) {
      attachedFiles = [...attachedFiles, ...newFiles];
    }
    if (skipped.length > 0) {
      showDropMessage(`Skipped: ${skipped.join(', ')}`, true);
    }
    textarea?.focus();
  }

  // ─── Clipboard paste ───

  async function handlePaste(e: ClipboardEvent) {
    if (!e.clipboardData) return;

    const images = extractClipboardImages(e.clipboardData);
    if (images.length === 0) return;

    // Prevent default only when we have images to handle (preserve normal text paste)
    e.preventDefault();

    const { files: newFiles, skipped } = await processFiles(images, attachedFiles);
    if (newFiles.length > 0) {
      attachedFiles = [...attachedFiles, ...newFiles];
    }
    if (skipped.length > 0) {
      showDropMessage(`Skipped: ${skipped.join(', ')}`, true);
    }
    textarea?.focus();
  }

  // ─── File picker ───

  let fileInput: HTMLInputElement;

  function openFilePicker() {
    fileInput?.click();
  }

  async function handleFileInputChange() {
    const files = fileInput?.files;
    if (!files || files.length === 0) return;

    const { files: newFiles, skipped } = await processFiles(files, attachedFiles);
    if (newFiles.length > 0) {
      attachedFiles = [...attachedFiles, ...newFiles];
    }
    if (skipped.length > 0) {
      showDropMessage(`Skipped: ${skipped.join(', ')}`, true);
    }
    // Reset so the same file can be re-selected
    fileInput.value = '';
    textarea?.focus();
  }

  function removeAttachedFile(index: number) {
    attachedFiles = attachedFiles.filter((_, i) => i !== index);
    textarea?.focus();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={container}
  class="bg-background border-t border-border relative flex flex-col shrink-0 max-h-[50vh]"
  class:ring-2={dragOver}
  class:ring-primary={dragOver}
  class:ring-inset={dragOver}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <!-- Resize handle -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="h-1 cursor-ns-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
    onmousedown={handleResizeMousedown}
  ></div>

  {#if pickerOpen}
    <FilePickerPopup
      bind:this={pickerRef}
      {sessionId}
      query={pickerQuery}
      onselect={selectFile}
      onclose={closePicker}
    />
  {/if}

  <!-- Slash command autocomplete -->
  {#if commandPickerOpen && filteredCommands.length > 0}
    <div class="absolute bottom-full left-4 mb-1 z-50 w-80">
      <Command.Root shouldFilter={false} class="border border-border shadow-xl">
        <Command.List class="max-h-48">
          <Command.Group heading="Commands">
            {#each filteredCommands as cmd, i}
              <Command.Item
                value={cmd.name}
                onSelect={() => selectCommand(cmd)}
                data-selected={i === commandSelectedIndex || undefined}
                class={i === commandSelectedIndex ? 'bg-accent text-accent-foreground' : ''}
              >
                <span class="font-mono text-primary">{cmd.name}</span>
                {#if cmd.description}
                  <Command.Shortcut class="text-muted-foreground text-xs truncate">{cmd.description}</Command.Shortcut>
                {/if}
              </Command.Item>
            {/each}
          </Command.Group>
          <Command.Empty>No matching commands</Command.Empty>
        </Command.List>
      </Command.Root>
    </div>
  {/if}

  <!-- Drop overlay -->
  {#if dragOver}
    <div class="absolute inset-0 bg-primary/10 z-40 flex items-center justify-center pointer-events-none">
      <span class="text-primary text-sm font-medium">Drop files to attach</span>
    </div>
  {/if}

  <!-- Drop feedback message -->
  {#if dropMessage}
    <div class="px-4 pt-2 text-xs {dropMessage.isError ? 'text-destructive' : 'text-muted-foreground'}">
      {dropMessage.text}
    </div>
  {/if}

  <!-- Attached file chips -->
  {#if attachedFiles.length > 0}
    <div class="flex flex-wrap gap-1.5 px-4 pt-2 max-h-24 overflow-y-auto">
      {#each attachedFiles as file, i}
        <span class="inline-flex items-center gap-1 bg-primary/15 text-primary text-xs px-2 py-1 font-mono border border-primary/25">
          {#if file.type === 'image'}
            <img src={file.dataUrl} alt={file.name} class="w-5 h-5 object-cover shrink-0" />
          {:else}
            <svg class="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.5 1A1.5 1.5 0 002 2.5v11A1.5 1.5 0 003.5 15h9a1.5 1.5 0 001.5-1.5V5.621a1 1 0 00-.293-.707l-3.621-3.621A1 1 0 009.379 1H3.5z"/>
            </svg>
          {/if}
          {file.name}
          <button
            onclick={() => removeAttachedFile(i)}
            class="text-primary/50 hover:text-primary transition-colors ml-0.5"
            title="Remove"
          >&times;</button>
        </span>
      {/each}
    </div>
  {/if}

  <!-- Prompt suggestions -->
  {#if promptSuggestions.length > 0 && !isRunning}
    <div class="flex flex-wrap gap-1.5 px-4 pt-2">
      {#each promptSuggestions as suggestion}
        <button
          onclick={() => useSuggestion(suggestion)}
          class="text-xs px-2.5 py-1 border border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors truncate max-w-80"
          title={suggestion}
        >
          {suggestion}
        </button>
      {/each}
    </div>
  {/if}

  <div class="flex gap-2 items-end px-4 pb-3 pt-2">
    <!-- Hidden file input for picker -->
    <input
      bind:this={fileInput}
      type="file"
      multiple
      accept="image/jpeg,image/png,image/gif,image/webp,.ts,.tsx,.js,.jsx,.svelte,.vue,.html,.css,.scss,.less,.json,.yaml,.yml,.toml,.xml,.md,.txt,.csv,.sql,.py,.rb,.go,.rs,.java,.kt,.c,.cpp,.h,.hpp,.cs,.swift,.php,.sh,.bash,.lua,.dart,.zig,.jl,.graphql,.log,.diff,.patch,.svg"
      onchange={handleFileInputChange}
      class="hidden"
    />

    <button
      onclick={openFilePicker}
      disabled={isRunning}
      title="Attach files"
      class="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed p-1 self-center"
    >
      <svg class="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M10.5 4.5l-5 5a2.12 2.12 0 003 3l5.5-5.5a3.54 3.54 0 00-5-5L3.5 7.5a4.95 4.95 0 007 7L15 10" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <textarea
      bind:this={textarea}
      bind:value
      spellcheck={settingsStore.current.spellcheck}
      oninput={handleInput}
      onkeydown={handleKeydown}
      onpaste={handlePaste}
      placeholder={isRunning ? 'Waiting for agent...' : 'Message (Enter to send, @ for files, / for commands, ! for shell)'}
      rows="1"
      class="flex-1 bg-card border px-3 py-2 text-sm text-foreground
        placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring
        disabled:opacity-50 disabled:cursor-not-allowed font-mono
        {isRunning ? 'border-muted opacity-60' : 'border-input'}"
    ></textarea>

    {#if isRunning}
      <Button variant="outline" onclick={handleStop} class="text-destructive border-destructive hover:bg-destructive/10 h-auto">
        Stop
      </Button>
    {:else}
      <Button
        variant="outline"
        onclick={handleSubmit}
        disabled={!value.trim() || !canSend}
        class="text-primary border-primary hover:bg-primary/10 h-auto"
      >
        Send
      </Button>
    {/if}
  </div>
</div>
