<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import FilePickerPopup from './FilePickerPopup.svelte';
  import { Button } from '$lib/components/ui/button/index.js';

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

    const atPattern = /@([\w.\/\-]+)/g;
    const refs: string[] = [];
    let match;
    while ((match = atPattern.exec(text)) !== null) {
      refs.push(match[1]);
    }

    if (refs.length > 0) {
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
        messageStore.addUserMessage(sessionId, text);
        window.groveBench.sendMessage(sessionId, fullMessage);
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

<div class="px-4 py-3 bg-background border-t border-border relative">
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
      class="flex-1 bg-card border border-input px-3 py-2 text-sm text-foreground
        placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring
        disabled:opacity-50 disabled:cursor-not-allowed font-mono"
    ></textarea>

    {#if isRunning}
      <Button variant="outline" size="sm" onclick={handleStop} class="text-muted-foreground hover:text-destructive hover:border-destructive">
        Stop
      </Button>
    {:else}
      <Button
        variant="outline"
        size="sm"
        onclick={handleSubmit}
        disabled={!value.trim() || !canSend}
        class="text-primary border-primary hover:bg-primary/10"
      >
        Send
      </Button>
    {/if}
  </div>
</div>
