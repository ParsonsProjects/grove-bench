<script lang="ts">
  import { messageStore, type QuestionItem } from '../stores/messages.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';

  let {
    sessionId,
    requestId,
    questions,
    resolved,
    response,
    selectedLabels,
  }: {
    sessionId: string;
    requestId: string;
    questions: QuestionItem[];
    resolved: boolean;
    response?: string;
    selectedLabels?: string[];
  } = $props();

  // Track selections per question (index in questions array → selected option indices)
  let selections = $state<Record<number, Set<number>>>({});
  let freeformText = $state('');

  function toggleOption(qIdx: number, optIdx: number, multiSelect: boolean) {
    const current = selections[qIdx] ?? new Set();
    if (multiSelect) {
      const next = new Set(current);
      if (next.has(optIdx)) next.delete(optIdx);
      else next.add(optIdx);
      selections = { ...selections, [qIdx]: next };
    } else {
      selections = { ...selections, [qIdx]: new Set([optIdx]) };
    }
  }

  function isSelected(qIdx: number, optIdx: number): boolean {
    return selections[qIdx]?.has(optIdx) ?? false;
  }

  let canSubmit = $derived(
    Object.values(selections).some((s) => s.size > 0) || freeformText.trim().length > 0
  );

  function buildResponse(): string {
    const parts: string[] = [];
    for (let qIdx = 0; qIdx < questions.length; qIdx++) {
      const q = questions[qIdx];
      const selected = selections[qIdx];
      if (selected && selected.size > 0) {
        const labels = [...selected].map((i) => q.options[i]?.label).filter(Boolean);
        if (questions.length > 1) {
          parts.push(`${q.header}: ${labels.join(', ')}`);
        } else {
          parts.push(labels.join(', '));
        }
      }
    }
    if (freeformText.trim()) {
      parts.push(freeformText.trim());
    }
    return parts.join('\n');
  }

  function submit() {
    const text = buildResponse();
    if (!text) return;
    // Collect exact labels for accurate resolved-state rendering
    const labels: string[] = [];
    for (let qIdx = 0; qIdx < questions.length; qIdx++) {
      const selected = selections[qIdx];
      if (selected) {
        for (const i of selected) {
          const label = questions[qIdx]?.options[i]?.label;
          if (label) labels.push(label);
        }
      }
    }
    messageStore.resolveQuestion(sessionId, requestId, text, labels.length > 0 ? labels : undefined);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }
</script>

<div class="py-1 my-1 border-l-4 {resolved ? 'border-blue-400' : 'border-cyan-400'} pl-3">
  {#each questions as q, qIdx}
    <div class={qIdx > 0 ? 'mt-3' : ''}>
      <div class="flex items-center gap-2 text-xs">
        <span class="text-cyan-400 font-bold">question</span>
        <span class="text-foreground font-medium">{q.header}</span>
      </div>
      <p class="text-sm text-foreground mt-1">{q.question}</p>

      {#if q.options.length > 0}
        <div class="flex flex-col gap-1 mt-2">
          {#each q.options as opt, optIdx}
            {#if resolved}
              <!-- Resolved: show which option was picked -->
              {@const wasChosen = selectedLabels ? selectedLabels.includes(opt.label) : response?.includes(opt.label)}
              <div
                class="text-xs px-3 py-1.5 border {wasChosen ? 'border-blue-400 bg-blue-500/10 text-foreground' : 'border-border text-muted-foreground opacity-50'}"
              >
                <span class="font-medium">{opt.label}</span>
                {#if opt.description}
                  <span class="ml-1 opacity-70">— {opt.description}</span>
                {/if}
              </div>
            {:else}
              <!-- Unresolved: clickable options -->
              <button
                onclick={() => toggleOption(qIdx, optIdx, q.multiSelect)}
                class="text-left text-xs px-3 py-1.5 border transition-colors cursor-pointer
                  {isSelected(qIdx, optIdx)
                    ? 'border-cyan-400 bg-cyan-500/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground'}"
              >
                <span class="font-medium">{opt.label}</span>
                {#if opt.description}
                  <span class="ml-1 opacity-70">— {opt.description}</span>
                {/if}
              </button>
            {/if}
          {/each}
        </div>
        {#if !resolved && q.multiSelect}
          <p class="text-xs text-muted-foreground mt-1 opacity-60">Select one or more options</p>
        {/if}
      {/if}
    </div>
  {/each}

  {#if resolved}
    <div class="text-xs mt-2 text-blue-400">
      answered{#if response}: <span class="text-foreground">{response}</span>{/if}
    </div>
  {:else}
    <!-- Free-form reply area -->
    <div class="flex gap-2 mt-3 items-center">
      <input
        type="text"
        bind:value={freeformText}
        onkeydown={handleKeydown}
        placeholder="Or type a custom response..."
        class="flex-1 text-xs bg-card border border-border px-2 py-1 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
      />
      <Button
        variant="outline"
        size="sm"
        onclick={submit}
        disabled={!canSubmit}
        class="text-cyan-400 border-cyan-600 hover:bg-cyan-900/30 shrink-0"
      >
        Answer
      </Button>
    </div>
  {/if}
</div>
