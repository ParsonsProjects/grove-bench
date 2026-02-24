<script lang="ts">
  let { disabled = false, onsubmit }: { disabled?: boolean; onsubmit: (message: string) => void } = $props();

  let text = $state('');
  let textarea: HTMLTextAreaElement;

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function send() {
    const msg = text.trim();
    if (!msg || disabled) return;
    text = '';
    // Reset textarea height
    if (textarea) textarea.style.height = 'auto';
    onsubmit(msg);
  }

  function autoResize() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }
</script>

<div class="flex items-end gap-2 px-4 py-3 border-t border-neutral-800 bg-neutral-950">
  <textarea
    bind:this={textarea}
    bind:value={text}
    oninput={autoResize}
    onkeydown={handleKeydown}
    {disabled}
    rows="1"
    placeholder={disabled ? 'Waiting for response...' : 'Send a message...'}
    class="flex-1 resize-none bg-neutral-800 text-neutral-100 px-3 py-2 rounded-lg text-sm border border-neutral-700
      focus:border-blue-500 focus:outline-none placeholder:text-neutral-500
      disabled:opacity-50 disabled:cursor-not-allowed"
  ></textarea>
  <button
    onclick={send}
    disabled={disabled || !text.trim()}
    class="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500
      rounded-lg text-sm transition-colors shrink-0"
  >
    Send
  </button>
</div>
