<script lang="ts">
  import { untrack } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import * as Segmented from '$lib/components/ui/segmented/index.js';
  import { prStore } from '../stores/pr.svelte.js';
  import type { ReviewComment } from '../lib/diff-types.js';
  import type { PrInfo, PrReviewEvent, PrReviewSubmitResult } from '../../shared/types.js';

  /**
   * Submit a review on the thread's PR from the Changes tab: comment,
   * approve or request changes, with a summary. The Branch view's line
   * comments go with it, on their lines where GitHub can take them.
   */
  let {
    sessionId,
    pr,
    comments,
    onclose,
    onposted,
  }: {
    sessionId: string;
    pr: PrInfo;
    /** Line comments written in the Branch view, posted with the review. */
    comments: ReviewComment[];
    onclose: () => void;
    onposted: (posted: { event: PrReviewEvent; result: PrReviewSubmitResult; commentIds: string[] }) => void;
  } = $props();

  const EVENTS: { id: PrReviewEvent; label: string; hint: string }[] = [
    { id: 'COMMENT', label: 'Comment', hint: 'Feedback without approving or blocking.' },
    { id: 'APPROVE', label: 'Approve', hint: 'You are happy for it to merge.' },
    { id: 'REQUEST_CHANGES', label: 'Request changes', hint: 'It needs changes before it can merge.' },
  ];

  let open = $state(true);
  let event = $state<PrReviewEvent>('COMMENT');
  let body = $state('');
  let submitting = $state(false);
  let error = $state('');

  /** GitHub only lets a PR's author comment on it. */
  let ownPr = $derived(pr.viewerIsAuthor === true);
  let needsSummary = $derived(event !== 'APPROVE');
  let canSubmit = $derived(!submitting && (!needsSummary || body.trim().length > 0));
  // Taken when the dialog opens: comments added behind it aren't in the count.
  const sent = untrack(() => comments.map((c) => ({ ...c })));

  // Closing doesn't stop a review on its way to GitHub, and its outcome
  // would be lost with the dialog, so it stays open until GitHub answers.
  function close() {
    if (submitting) return;
    open = false;
    onclose();
  }

  async function submit() {
    if (!canSubmit) return;
    submitting = true;
    error = '';
    try {
      const result = await prStore.submitReview(sessionId, {
        prNumber: pr.number,
        event,
        body: body.trim(),
        comments: sent.map((c) => ({
          filePath: c.filePath,
          side: c.side,
          startLine: c.startLine,
          endLine: c.endLine,
          snippet: c.snippet,
          body: c.body,
        })),
      });
      onposted({ event, result, commentIds: sent.map((c) => c.id) });
      submitting = false;
      close();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      submitting = false;
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={(v) => { if (!v) close(); }}>
  <Dialog.Content
    class="max-w-lg"
    showCloseButton={!submitting}
    escapeKeydownBehavior={submitting ? 'ignore' : 'close'}
    interactOutsideBehavior={submitting ? 'ignore' : 'close'}
  >
    <Dialog.Header>
      <Dialog.Title>Review PR #{pr.number}</Dialog.Title>
      {#if pr.title}
        <Dialog.Description class="truncate" title={pr.title}>{pr.title}</Dialog.Description>
      {/if}
    </Dialog.Header>

    <div class="flex flex-col gap-3 mt-2">
      <div class="space-y-1.5">
        <Segmented.Root bind:value={event} aria-label="Review type" class="flex w-full" disabled={submitting}>
          {#each EVENTS as option (option.id)}
            <Segmented.Item
              value={option.id}
              disabled={ownPr && option.id !== 'COMMENT'}
              class="flex-1 justify-center py-1"
              title={ownPr && option.id !== 'COMMENT' ? 'GitHub does not let you do this on your own PR' : option.hint}
            >{option.label}</Segmented.Item>
          {/each}
        </Segmented.Root>
        <p class="text-caption text-muted-foreground">{EVENTS.find((o) => o.id === event)?.hint}</p>
      </div>

      {#if ownPr}
        <Notice tone="neutral">
          <p>This is your own PR, so GitHub only lets you comment. Approving or requesting changes needs another reviewer.</p>
        </Notice>
      {/if}

      <div>
        <Label for="pr-review-body" class="mb-1 block">
          Summary{#if !needsSummary}<span class="text-muted-foreground font-normal"> (optional)</span>{/if}
        </Label>
        <!-- svelte-ignore a11y_autofocus -->
        <textarea
          id="pr-review-body"
          bind:value={body}
          rows="5"
          autofocus
          placeholder={needsSummary ? 'What should the author know? (Markdown)' : 'Anything to add? (Markdown)'}
          onkeydown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(); } }}
          class="w-full text-sm bg-background border border-input px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
        ></textarea>
      </div>

      {#if sent.length > 0}
        <p class="text-caption text-muted-foreground">
          {sent.length} line comment{sent.length === 1 ? '' : 's'} from the Branch view go{sent.length === 1 ? 'es' : ''} with it.
          If one can't go on its line (the line isn't in the PR's diff, or it reads differently there now), it's quoted in the summary instead.
        </p>
      {/if}

      {#if error}
        <Notice tone="danger">
          <p class="whitespace-pre-wrap">{error}</p>
        </Notice>
      {/if}

      <Dialog.Footer>
        <Button variant="subtle" onclick={close} disabled={submitting}>Cancel</Button>
        <Button
          onclick={submit}
          disabled={!canSubmit}
          title={needsSummary && !body.trim() ? 'Write a summary to comment or request changes' : undefined}
        >
          {#if submitting}
            <span class="inline-flex items-center gap-1.5">
              <Pulse motion="spin" size="sm" tone="current" />
              Submitting…
            </span>
          {:else}
            Submit review
          {/if}
        </Button>
      </Dialog.Footer>
    </div>
  </Dialog.Content>
</Dialog.Root>
