<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import MessageList from './MessageList.svelte';
  import MessageInput from './MessageInput.svelte';

  let { sessionId }: { sessionId: string } = $props();

  onMount(() => {
    messageStore.subscribe(sessionId);
  });

  onDestroy(() => {
    messageStore.unsubscribe(sessionId);
  });
</script>

<div class="flex flex-col h-full bg-neutral-950">
  <MessageList {sessionId} />
  <MessageInput {sessionId} />
</div>
