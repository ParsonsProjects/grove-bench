<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLTextareaAttributes } from 'svelte/elements';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Segmented from '$lib/components/ui/segmented/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import MarkdownBlock from './MarkdownBlock.svelte';

  type TextEditorView = 'write' | 'preview';

  /**
   * A larger editor for text typed in a small box (the thread's prompt box,
   * the system prompt setting): the same text, bound both ways, in a dialog
   * most of the window's size. `markdown` adds a Write / Preview switch,
   * shared with the small box through `view`. Other textarea attributes
   * (keys, paste, drop, placeholder) go on its textarea.
   */
  let {
    open = $bindable(false),
    value = $bindable(''),
    view = $bindable<TextEditorView>('write'),
    title,
    description,
    markdown = false,
    above,
    footer,
    returnFocus,
    ...textareaProps
  }: Omit<HTMLTextareaAttributes, 'value' | 'title'> & {
    open?: boolean;
    value?: string;
    view?: TextEditorView;
    title: string;
    description?: string;
    /** Offer a rendered Markdown preview. */
    markdown?: boolean;
    /** Shown between the title and the text, such as attached files. */
    above?: Snippet;
    /** The dialog's buttons; a Done button without one. */
    footer?: Snippet;
    /** Where focus goes once it closes; back to what opened it without one. */
    returnFocus?: () => void;
  } = $props();

  let textarea: HTMLTextAreaElement | null = $state(null);
  const previewing = $derived(markdown && view === 'preview');

  /** Put the cursor at the end of the text, where the small box left off. */
  function focusEnd(e: Event) {
    if (!textarea) return;
    e.preventDefault();
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function restoreFocus(e: Event) {
    if (!returnFocus) return;
    e.preventDefault();
    returnFocus();
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="sm:max-w-4xl h-[85vh] flex flex-col gap-3"
    onOpenAutoFocus={focusEnd}
    onCloseAutoFocus={restoreFocus}
  >
    <Dialog.Header class="pr-8">
      <div class="flex items-center justify-between gap-3">
        <Dialog.Title>{title}</Dialog.Title>
        {#if markdown}
          <Segmented.Root bind:value={() => view, (v) => (view = v as TextEditorView)} aria-label="{title} view">
            <Segmented.Item value="write">Write</Segmented.Item>
            <Segmented.Item value="preview">Preview</Segmented.Item>
          </Segmented.Root>
        {/if}
      </div>
      {#if description}
        <Dialog.Description>{description}</Dialog.Description>
      {/if}
    </Dialog.Header>

    {@render above?.()}

    {#if previewing}
      <div class="flex-1 min-h-0 overflow-auto border border-input bg-card px-3 py-2 text-sm">
        {#if value.trim()}
          <MarkdownBlock content={value} />
        {:else}
          <p class="text-muted-foreground">Nothing to preview.</p>
        {/if}
      </div>
    {:else}
      <textarea
        bind:this={textarea}
        bind:value
        aria-label={title}
        {...textareaProps}
        class="flex-1 min-h-0 w-full resize-none border border-input bg-card px-3 py-2 text-sm text-foreground font-mono
          placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      ></textarea>
    {/if}

    <Dialog.Footer class="items-center">
      {#if footer}
        {@render footer()}
      {:else}
        <Button size="sm" onclick={() => (open = false)}>Done</Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
