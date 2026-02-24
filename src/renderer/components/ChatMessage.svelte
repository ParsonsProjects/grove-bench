<script lang="ts">
  import type { ChatMessage as ChatMessageType } from '../stores/sessions.svelte.js';
  import TextBlock from './TextBlock.svelte';
  import ToolCallBlock from './ToolCallBlock.svelte';
  import PermissionCard from './PermissionCard.svelte';

  let { message, sessionId }: { message: ChatMessageType; sessionId: string } = $props();
</script>

{#if message.role === 'user'}
  <div class="flex justify-end">
    <div class="bg-blue-600/20 border border-blue-500/30 rounded-lg px-4 py-2 max-w-[80%]">
      <p class="text-sm whitespace-pre-wrap">{message.blocks[0]?.type === 'text' ? message.blocks[0].text : ''}</p>
    </div>
  </div>
{:else}
  <div class="space-y-1">
    {#each message.blocks as block}
      {#if block.type === 'text'}
        <TextBlock text={block.text} />
      {:else if block.type === 'tool_use'}
        <ToolCallBlock name={block.name} input={block.input} />
      {:else if block.type === 'permission'}
        <PermissionCard
          requestId={block.requestId}
          toolName={block.toolName}
          input={block.input}
          resolved={block.resolved}
          allowed={block.allowed}
          {sessionId}
        />
      {/if}
    {/each}
  </div>
{/if}
