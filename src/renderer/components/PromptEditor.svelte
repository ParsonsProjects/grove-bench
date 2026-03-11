<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import FilePickerPopup from './FilePickerPopup.svelte';

  let { sessionId }: { sessionId: string } = $props();

  let value = $state('');
  let textarea: HTMLTextAreaElement;
  let pickerOpen = $state(false);
  let pickerQuery = $state('');
  let atStartIndex = $state(-1);
  let pickerRef: FilePickerPopup | undefined = $state();

  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let isReady = $derived(messageStore.getIsReady(sessionId));
  let canSend = $derived(!isRunning);

  function handleSubmit() {
    const text = value.trim();
    if (!text || !canSend) return;

    // Parse @path references and read file contents
    const atPattern = /@([\w.\/\-]+)/g;
    const refs: string[] = [];
    let match;
    while ((match = atPattern.exec(text)) !== null) {
      refs.push(match[1]);
    }

    if (refs.length > 0) {
      // Read files and prepend to message
      Promise.all(
        refs.map(async (ref) => {
          try {
            const content = await window.groveBench.readFile(sessionId, ref);
            return `<file path="${ref}">\n${content}\n</file>`;
          } catch {
            return `<file path="${ref}">\n(could not read file)\n</file>`;
          }
        })
      ).then((fileTags) => {
        const prefix = fileTags.join('\n') + '\n\n';
        const fullMessage = prefix + text;
        messageStore.addUserMessage(sessionId, text); // Show original text in UI
        window.groveBench.sendMessage(sessionId, fullMessage); // Send with file contents
      });
    } else {
      messageStore.addUserMessage(sessionId, text);
      messageStore.ingestEvent(sessionId, { type: 'status', message: `[debug] calling sendMessage sessionId=${sessionId}` } as any);
      window.groveBench.sendMessage(sessionId, text);
      messageStore.ingestEvent(sessionId, { type: 'status', message: `[debug] sendMessage returned` } as any);
    }

    value = '';
    closePicker();
    if (textarea) textarea.style.height = 'auto';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (pickerOpen && pickerRef) {
      if (pickerRef.handleKeydown(e)) return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleInput() {
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    }

    // Detect @ for file picker
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

  function selectFile(path: string) {
    // Replace @query with @path
    const before = value.slice(0, atStartIndex);
    const after = value.slice(textarea?.selectionStart ?? value.length);
    value = before + '@' + path + ' ' + after;
    closePicker();
    textarea?.focus();
  }

  function handleStop() {
    window.groveBench.stopSession(sessionId);
  }
</script>

<div class="px-4 py-3 bg-neutral-950 border-t border-neutral-800 relative">
  {#if pickerOpen}
    <FilePickerPopup
      bind:this={pickerRef}
      {sessionId}
      query={pickerQuery}
      onselect={selectFile}
      onclose={closePicker}
    />
  {/if}

  <div class="flex gap-2 items-end">
    <textarea
      bind:this={textarea}
      bind:value
      oninput={handleInput}
      onkeydown={handleKeydown}
      disabled={false}
      placeholder={isRunning ? 'Waiting for Claude...' : 'Message (Enter to send, @ for files)'}
      rows="1"
      class="flex-1 bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm text-neutral-200
        placeholder:text-neutral-600 resize-none focus:outline-none focus:border-blue-500
        disabled:opacity-50 disabled:cursor-not-allowed font-mono"
    ></textarea>

    {#if isRunning}
      <button
        onclick={handleStop}
        class="px-3 py-2 border border-neutral-600 hover:border-red-500 hover:text-red-400 text-xs text-neutral-400 transition-colors shrink-0"
      >
        Stop
      </button>
    {:else}
      <button
        onclick={handleSubmit}
        disabled={!value.trim() || !canSend}
        class="px-3 py-2 border border-blue-600 hover:bg-blue-600/20 disabled:border-neutral-700 disabled:text-neutral-600
          text-xs text-blue-400 transition-colors shrink-0"
      >
        Send
      </button>
    {/if}
  </div>
</div>
