<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import MarkdownBlock from './MarkdownBlock.svelte';
  import { topics, type HelpTopic } from '../help/index.js';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();

  let selectedTopicId = $state(topics[0].id);
  let contentEl: HTMLDivElement;

  const selectedTopic = $derived(topics.find(t => t.id === selectedTopicId) ?? topics[0]);

  // Group topics by section, preserving order
  const sections = $derived.by(() => {
    const map = new Map<string, HelpTopic[]>();
    for (const topic of topics) {
      const group = map.get(topic.section);
      if (group) {
        group.push(topic);
      } else {
        map.set(topic.section, [topic]);
      }
    }
    return map;
  });

  // Reset scroll when topic changes
  $effect(() => {
    selectedTopicId; // track
    if (contentEl) {
      contentEl.scrollTop = 0;
    }
  });
</script>

<Dialog.Root {open} onOpenChange={(o) => { if (!o) onclose(); }}>
  <Dialog.Content class="sm:max-w-4xl max-h-[90vh] flex flex-col">
    <Dialog.Header>
      <Dialog.Title>Help</Dialog.Title>
      <Dialog.Description>
        Learn how to use Grove Bench and what the interface elements mean.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex gap-3 flex-1 min-h-0 overflow-hidden">
      <!-- Topic sidebar -->
      <nav class="w-48 shrink-0 overflow-auto border-r border-border pr-3">
        {#each sections as [section, sectionTopics]}
          <div class="mb-3">
            <span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">{section}</span>
            {#each sectionTopics as topic}
              <button
                onclick={() => selectedTopicId = topic.id}
                class="w-full text-left text-xs px-2 py-1 rounded transition-colors
                  {selectedTopicId === topic.id ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/50'}"
              >
                {topic.title}
              </button>
            {/each}
          </div>
        {/each}
      </nav>

      <!-- Content area -->
      <div class="flex-1 min-w-0 overflow-auto text-sm" bind:this={contentEl}>
        <MarkdownBlock content={selectedTopic.content} />
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="secondary" onclick={onclose}>Close</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
