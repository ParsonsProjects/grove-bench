<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { arrivalScene } from '../stores/arrivalScene.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { terminalStore } from '../stores/terminal.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { store as sessionStore } from '../stores/sessions.svelte.js';
  import type FilePickerPopup from './FilePickerPopup.svelte';
  import { lazyComponent } from '../lib/lazy-component.js';
  import { canCompact } from '../lib/agent-commands.js';
  import MessageQueue from './MessageQueue.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Kbd } from '$lib/components/ui/kbd/index.js';
  import * as Command from '$lib/components/ui/command/index.js';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import ListPlusIcon from '@lucide/svelte/icons/list-plus';
  import PaperclipIcon from '@lucide/svelte/icons/paperclip';
  import SquareIcon from '@lucide/svelte/icons/square';
  import {
    type AttachedFile,
    processFiles,
    extractClipboardImages,
    attachmentPayload,
  } from '$lib/file-attachments.js';
  import AttachmentChips from './AttachmentChips.svelte';
  import { extractAtRefs, buildRefTags, buildOutgoingMessage } from '$lib/prompt-file-refs.js';

  let { sessionId }: { sessionId: string } = $props();

  // Restore the draft before the first render (sessionId is stable per
  // instance). Set in onMount instead, the resize below would measure the
  // textarea before bind:value had written the draft into it.
  let value = $state(untrack(() => messageStore.getDraft(sessionId)));
  let textarea: HTMLTextAreaElement;

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

  // A pane that mounts hidden (another conversation or the draft is open)
  // can't size its prompt box: autoResize skips it while there is no layout.
  // Showing the pane gives the textarea a width, so size it then. Resizing
  // inside the callback lands before paint; the browser then reports a
  // "ResizeObserver loop" error, which is benign (error-handling.ts skips it).
  $effect(() => {
    const el = textarea;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let shown = el.clientWidth > 0;
    const observer = new ResizeObserver(() => {
      const wasShown = shown;
      shown = el.clientWidth > 0;
      if (shown && !wasShown && (value || showSuggestion)) autoResize();
    });
    observer.observe(el);
    return () => observer.disconnect();
  });

  // Insert text pushed from elsewhere (e.g. the activity thread's "copy
  // selection to prompt", or a rewind's message text, which replaces it).
  // Initialised from the current nonce so a stale request doesn't re-fire
  // when this editor (re)mounts.
  let lastInsertNonce = untrack(() => messageStore.promptInsertBySession[sessionId]?.nonce ?? 0);
  $effect(() => {
    const req = messageStore.promptInsertBySession[sessionId];
    if (!req || req.nonce === lastInsertNonce) return;
    lastInsertNonce = req.nonce;
    value = req.replace ? req.text : value ? `${value}\n${req.text}` : req.text;
    if (req.attachments?.length) attachedFiles = [...attachedFiles, ...req.attachments];
    void tick().then(() => { textarea?.focus(); autoResize(); });
  });
  let userResized = $state(false);
  let pickerOpen = $state(false);
  let pickerQuery = $state('');
  let atStartIndex = $state(-1);
  let pickerRef: FilePickerPopup | undefined = $state();
  // The @ file picker (and fuse.js, which only it uses here) loads the first
  // time @ is typed.
  const loadFilePicker = lazyComponent(() => import('./FilePickerPopup.svelte'));

  // File attachments (drag-drop, paste, file picker), restored and kept in
  // the store like the draft so they outlive this editor.
  /** Whether this conversation's agent takes image attachments. */
  let allowImages = $derived(agentsStore.supports(sessionStore.sessions.find((s) => s.id === sessionId)?.agentType, 'imageAttachments'));

  let attachedFiles = $state<AttachedFile[]>(untrack(() => [...messageStore.getAttachments(sessionId)]));
  $effect(() => {
    messageStore.setAttachments(sessionId, $state.snapshot(attachedFiles));
  });
  let dragOver = $state(false);
  let dropMessage = $state<{ text: string; isError: boolean } | null>(null);
  let dropMessageTimer: ReturnType<typeof setTimeout> | undefined;

  // Slash command autocomplete
  let commandPickerOpen = $state(false);
  let commandQuery = $state('');
  let commandSelectedIndex = $state(0);

  // /compact only for an agent that can summarise the thread.
  let builtinCommands = $derived([
    ...(canCompact(sessionId) ? [{ name: '/compact', description: 'Compact thread to free context space' }] : []),
    { name: '/clear', description: 'Clear thread and start fresh' },
    { name: '/rewind', description: 'Rewind to a previous checkpoint' },
  ]);

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

  // The input is always usable — never gated on system_init or on a running
  // turn. The SDK's system_init can take 30+ seconds (or never arrive for a
  // fresh query until it has a prompt to process), so the first prompt goes
  // straight to main, where it waits in the SDK's input stream until the
  // agent connects. Anything submitted while the agent is busy (connecting
  // or mid-turn) is queued in the store and sent when the turn finishes; the
  // queue is shown above the input so items can be removed before they go.
  let willQueue = $derived(!messageStore.canSendNow(sessionId));
  // The agent's guess at the next prompt, shown as the empty box's
  // placeholder until something is typed. Tab takes it.
  let suggestion = $derived(
    settingsStore.current.promptSuggestions && !isRunning ? messageStore.getPromptSuggestion(sessionId) : null,
  );
  let showSuggestion = $derived(!!suggestion && !value);

  // Size the empty box to the suggestion, which may wrap, and back to one
  // line when it goes. Chromium counts a placeholder in scrollHeight. Keyed
  // on the text, so a newer suggestion of another length is sized too.
  $effect(() => {
    const shown = showSuggestion ? suggestion : null;
    untrack(() => {
      if (!textarea || value || userResized) return;
      if (shown) autoResize();
      else textarea.style.height = '';
    });
  });

  function handleSubmit() {
    const text = value.trim();
    if (!text) return;

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
        // Ensure PTY is alive, then write the command + Enter. Shares the
        // in-flight check with the terminal panel mounting on tab switch.
        void (async () => {
          await terminalStore.ensureAlive(sessionId);
          terminalStore.write(sessionId, cmd + '\r');
        })();
      }
      return;
    }

    // Check if it's a slash command
    if (text.startsWith('/')) {
      messageStore.submitCommand(sessionId, text);
      value = '';
      closePicker();
      closeCommandPicker();
      userResized = false;
      if (textarea) textarea.style.height = '';
      // Sending from the Changes tab returns to Activity so the response shows.
      messageStore.setActiveTab(sessionId, 'activity');
      return;
    }

    const refs = extractAtRefs(text);

    // Text files go in the message text; images and other files alongside it
    const { tags: droppedTags, images, files } = attachmentPayload(attachedFiles);

    const displayText = attachedFiles.length > 0
      ? `[${attachedFiles.map((f) => f.name).join(', ')}] ${text}`
      : text;
    // Kept on a queued prompt so Edit can restore it as typed.
    const typed = { text, attachments: $state.snapshot(attachedFiles) };

    // Sends now if the agent is idle, otherwise parks the prompt in the queue.
    function send(outgoing: string) {
      messageStore.submitMessage(sessionId, {
        displayText,
        outgoing,
        images: images.length > 0 ? images : undefined,
        files: files.length > 0 ? files : undefined,
        typed,
      });
    }

    if (refs.length > 0) {
      void buildRefTags(refs, (ref) => window.groveBench.readFile(sessionId, ref)).then((refTags) => {
        send(buildOutgoingMessage([...droppedTags, ...refTags], text));
      });
    } else {
      send(buildOutgoingMessage(droppedTags, text));
    }

    value = '';
    attachedFiles = [];
    messageStore.clearPromptSuggestion(sessionId);
    closePicker();
    closeCommandPicker();
    userResized = false;
    if (container) container.style.height = '';
    if (textarea) textarea.style.height = '';
    // Sending from the Changes tab returns to Activity so the response shows
    // (no-op when already on Activity).
    messageStore.setActiveTab(sessionId, 'activity');
  }

  /** Put the suggested prompt in the box, to send as it is or edit first. */
  function useSuggestion(text: string) {
    value = text;
    messageStore.clearPromptSuggestion(sessionId);
    textarea?.focus();
    handleInput();
  }

  /** Keys the @ picker takes. Held while its code is still loading, so
   *  Enter can't send a half-typed @ reference (Escape closes it). */
  const PICKER_KEYS = new Set(['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown']);

  function handleKeydown(e: KeyboardEvent) {
    if (pickerOpen && pickerRef) {
      if (pickerRef.handleKeydown(e)) return;
    } else if (pickerOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePicker();
        return;
      }
      if (PICKER_KEYS.has(e.key) && !e.shiftKey) {
        e.preventDefault();
        return;
      }
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

    // Tab takes the suggested prompt. Without one, Tab moves focus as usual.
    if (e.key === 'Tab' && showSuggestion && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      useSuggestion(suggestion!);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function autoResize() {
    if (!textarea || userResized) return;
    // Hidden: no layout, so scrollHeight reads 0 and the box would collapse
    // to its padding. The observer above sizes it once it is shown.
    if (textarea.clientWidth === 0) return;
    textarea.style.height = '0';
    // scrollHeight leaves out the border, and the box is border-box, so add
    // it back or the box comes out 2px short (and shrinks on the first key)
    const border = textarea.offsetHeight - textarea.clientHeight;
    const scrollH = textarea.scrollHeight + border;
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
    // Same characters extractAtRefs accepts: anything but whitespace.
    const atMatch = textBefore.match(/@(\S*)$/);

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
    // A stopped turn may report no result, so nothing else would end it.
    arrivalScene.end(sessionId);
    void window.groveBench.stopSession(sessionId);
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

    const { files: newFiles, skipped } = await processFiles(files, attachedFiles, { allowImages });
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

    // Clipboard images all arrive named "image.png" — rename collisions so
    // pasting several screenshots attaches each one instead of only the first.
    const { files: newFiles, skipped } = await processFiles(images, attachedFiles, { renameDuplicates: true, allowImages });
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

    const { files: newFiles, skipped } = await processFiles(files, attachedFiles, { allowImages });
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
    {#await loadFilePicker() then Picker}
      <Picker
        bind:this={pickerRef}
        {sessionId}
        query={pickerQuery}
        onselect={selectFile}
        onclose={closePicker}
      />
    {/await}
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
                  <span class="ms-auto truncate text-xs text-muted-foreground">{cmd.description}</span>
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
    <AttachmentChips files={attachedFiles} onremove={removeAttachedFile} class="px-4 pt-2" />
  {/if}

  <!-- Queued messages (waiting for the agent to be free) -->
  <MessageQueue {sessionId} />

  <div class="flex gap-2 items-end px-4 pb-3 pt-2">
    <!-- Hidden file input for picker -->
    <input
      bind:this={fileInput}
      type="file"
      multiple
      onchange={handleFileInputChange}
      class="hidden"
    />

    <Button
      variant="quiet"
      size="icon-xs"
      onclick={openFilePicker}
      title="Attach files"
      aria-label="Attach files"
      class="self-center disabled:cursor-not-allowed"
    >
      <PaperclipIcon />
    </Button>

    <div class="relative flex-1 min-w-0 flex">
      <!-- py-[7px]: 1px border + 7px + one 20px line + 7px + 1px = 36px, the
           height of the buttons beside it -->
      <textarea
        bind:this={textarea}
        bind:value
        spellcheck={settingsStore.current.spellcheck}
        oninput={handleInput}
        onkeydown={handleKeydown}
        onpaste={handlePaste}
        placeholder={suggestion ?? (willQueue ? 'Message (Enter to queue, sent when the agent is free)' : 'Message (Enter to send, @ for files, / for commands, ! for shell)')}
        aria-keyshortcuts={showSuggestion ? 'Tab' : undefined}
        rows="1"
        class="flex-1 min-w-0 bg-card border border-input px-3 py-[7px] text-sm text-foreground
          placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring
          disabled:opacity-50 disabled:cursor-not-allowed font-mono {showSuggestion ? 'pe-12' : ''}"
      ></textarea>
      {#if showSuggestion}
        <!-- 1px border + 7px + (20px line - 16px key) / 2 = 10px: centred on the line -->
        <Kbd variant="key" class="absolute end-2 top-2.5 pointer-events-none" aria-hidden="true">Tab</Kbd>
      {/if}
    </div>

    <Button
      variant="default"
      size="icon"
      onclick={handleSubmit}
      disabled={!value.trim()}
      title={willQueue ? 'Add to the queue; sent once the agent is free' : 'Send now'}
      aria-label={willQueue ? 'Queue' : 'Send'}
    >
      {#if willQueue}<ListPlusIcon />{:else}<ArrowUpIcon />{/if}
    </Button>
    {#if isRunning}
      <Button variant="outline-destructive" size="icon" onclick={handleStop} title="Stop the agent" aria-label="Stop">
        <SquareIcon class="size-3" fill="currentColor" />
      </Button>
    {/if}
  </div>
</div>
