<script lang="ts">
  /**
   * One image at full size in a dialog, over a checkerboard so transparency
   * shows. Open while `src` is set; closing calls `onclose`.
   */
  import * as Dialog from '$lib/components/ui/dialog/index.js';

  let { src, label, onclose }: { src: string | null; label: string; onclose: () => void } = $props();
</script>

<Dialog.Root open={src !== null} onOpenChange={(open) => { if (!open) onclose(); }}>
  <Dialog.Content class="w-auto max-w-[90vw] sm:max-w-[90vw] p-3 gap-2">
    {#if src !== null}
      <Dialog.Title class="text-xs font-normal text-muted-foreground truncate pr-8">{label}</Dialog.Title>
      <img
        {src}
        alt={label}
        class="max-w-full max-h-[80vh] object-contain mx-auto
          bg-[repeating-conic-gradient(var(--checker-a)_0_25%,var(--checker-b)_0_50%)] bg-[length:16px_16px]"
      />
    {/if}
  </Dialog.Content>
</Dialog.Root>
