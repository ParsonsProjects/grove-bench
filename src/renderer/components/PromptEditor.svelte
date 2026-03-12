<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import FilePickerPopup from './FilePickerPopup.svelte';
  import { Button } from '$lib/components/ui/button/index.js';

  let { sessionId }: { sessionId: string } = $props();

  let value = $state('');
  let textarea: HTMLTextAreaElement;
  let userResized = $state(false);
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
      window.groveBench.sendMessage(sessionId, text);
    }

    value = '';
    closePicker();
    userResized = false;
    if (container) container.style.height = '';
    if (textarea) textarea.style.height = '';
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

  function autoResize() {
    if (!textarea || !container || userResized) return;
    // Temporarily reset to measure natural height
    textarea.style.height = '0';
    const scrollH = textarea.scrollHeight;
    // pb-3(12) + pt-2(8) + resize handle h-1(4) + border(1)
    const padding = 25;
    const newHeight = Math.min(scrollH + padding, 200);
    container.style.height = newHeight + 'px';
    textarea.style.height = '100%';
  }

  function handleInput() {
    autoResize();

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
</script>

<div
  bind:this={container}
  class="bg-background border-t border-border relative flex flex-col shrink-0"
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

  <div class="flex gap-2 items-stretch flex-1 min-h-0 px-4 pb-3 pt-2">
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
