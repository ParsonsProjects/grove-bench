<script lang="ts">
  let { thinking }: { thinking: string } = $props();
  let open = $state(false);
</script>

<details class="py-1 text-xs" bind:open>
  <summary class="cursor-pointer text-neutral-500 hover:text-neutral-400 italic select-none">thinking...</summary>
  <div class="mt-1 pl-3 border-l-2 border-neutral-700 text-neutral-500 italic whitespace-pre-wrap">
    {thinking}
  </div>
</details>
