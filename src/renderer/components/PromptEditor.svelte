<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import FilePickerPopup from './FilePickerPopup.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Command from '$lib/components/ui/command/index.js';

  let { sessionId }: { sessionId: string } = $props();

  let value = $state('');
  let textarea: HTMLTextAreaElement;
  let userResized = $state(false);
  let pickerOpen = $state(false);
  let pickerQuery = $state('');
  let atStartIndex = $state(-1);
  let pickerRef: FilePickerPopup | undefined = $state();

  // Drag-and-drop file attachments
  type AttachedFile = { name: string; content: string; type: 'text' } | { name: string; dataUrl: string; type: 'image' };
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
  let isReady = $derived(messageStore.getIsReady(sessionId));
  let canSend = $derived(!isRunning);
  let promptSuggestions = $derived(messageStore.getPromptSuggestions(sessionId));

  function handleSubmit() {
    const text = value.trim();
    if (!text || !canSend) return;

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

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const MAX_TEXT_SIZE = 100 * 1024; // 100KB
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB (Claude API limit)
    const imageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
    const textExtensions = new Set([
      'ts', 'tsx', 'js', 'jsx', 'svelte', 'vue', 'html', 'css', 'scss', 'less',
      'json', 'yaml', 'yml', 'toml', 'xml', 'md', 'txt', 'csv', 'sql', 'sh',
      'bash', 'zsh', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'cpp', 'h',
      'hpp', 'cs', 'swift', 'php', 'r', 'lua', 'pl', 'ex', 'exs', 'elm',
      'hs', 'ml', 'fs', 'clj', 'scala', 'dart', 'conf', 'ini', 'env',
      'gitignore', 'dockerignore', 'dockerfile', 'makefile', 'cmake',
      'lock', 'log', 'diff', 'patch', 'svg',
    ]);

    const skipped: string[] = [];

    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const nameLC = file.name.toLowerCase();
      const isImage = imageTypes.has(file.type);
      const isText = textExtensions.has(ext) || textExtensions.has(nameLC) || file.type.startsWith('text/');

      if (isImage) {
        if (file.size > MAX_IMAGE_SIZE) {
          skipped.push(`${file.name} (too large, max 5MB)`);
          continue;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          if (!attachedFiles.some((f) => f.name === file.name)) {
            attachedFiles = [...attachedFiles, { name: file.name, dataUrl, type: 'image' }];
          }
        };
        reader.readAsDataURL(file);
      } else if (isText) {
        if (file.size > MAX_TEXT_SIZE) {
          skipped.push(`${file.name} (too large, max 100KB)`);
          continue;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const content = reader.result as string;
          if (!attachedFiles.some((f) => f.name === file.name)) {
            attachedFiles = [...attachedFiles, { name: file.name, content, type: 'text' }];
          }
        };
        reader.readAsText(file);
      } else {
        skipped.push(`${file.name} (unsupported type)`);
      }
    }

    if (skipped.length > 0) {
      showDropMessage(`Skipped: ${skipped.join(', ')}`, true);
    }

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
    <textarea
      bind:this={textarea}
      bind:value
      oninput={handleInput}
      onkeydown={handleKeydown}
      disabled={false}
      placeholder={isRunning ? 'Waiting for Claude...' : 'Message (Enter to send, @ for files, / for commands)'}
      rows="1"
      class="flex-1 bg-card border px-3 py-2 text-sm text-foreground
        placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring
        disabled:opacity-50 disabled:cursor-not-allowed font-mono
        {isRunning ? 'border-muted opacity-60' : 'border-input'}"
    ></textarea>

    {#if isRunning}
      <Button variant="outline" onclick={handleStop} class="text-muted-foreground hover:text-destructive hover:border-destructive h-auto">
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
