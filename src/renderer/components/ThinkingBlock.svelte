<script lang="ts">
  import CopyButton from './CopyButton.svelte';

  let { thinking }: { thinking: string } = $props();
  let open = $state(false);
</script>

<details class="py-1 text-xs" bind:open>
  <summary class="cursor-pointer text-muted-foreground hover:text-foreground/60 italic select-none">thinking...</summary>
  <div class="mt-1 pl-3 border-l-2 border-border text-muted-foreground italic whitespace-pre-wrap relative group/think">
    <CopyButton text={thinking} class="absolute top-0 right-0 opacity-0 group-hover/think:opacity-100" />
    {thinking}
  </div>
</details>
