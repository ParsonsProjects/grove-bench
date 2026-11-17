<script lang="ts">
  // What a memory compaction call sends: its system prompt, then the message.
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';

  interface Props {
    systemPrompt: string;
    userMessage: string;
    /** Tailwind max-height for the system prompt's box. */
    maxHeight?: string;
  }

  let { systemPrompt, userMessage, maxHeight = 'max-h-64' }: Props = $props();
</script>

<div class="flex flex-col gap-2 min-w-0">
  <div class="flex flex-col gap-1 min-w-0">
    <SectionLabel>System prompt</SectionLabel>
    <pre class="{maxHeight} overflow-auto text-xs text-foreground/80 whitespace-pre-wrap break-words p-2 bg-card border border-border font-mono" data-testid="compact-system-prompt">{systemPrompt}</pre>
  </div>
  <div class="flex flex-col gap-1 min-w-0">
    <SectionLabel>Message</SectionLabel>
    <pre class="text-xs text-foreground/80 whitespace-pre-wrap break-words p-2 bg-card border border-border font-mono">{userMessage}</pre>
  </div>
</div>
