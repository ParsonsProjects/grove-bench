<script lang="ts">
  let { text }: { text: string } = $props();
</script>

<div class="py-2 text-sm text-neutral-200">
  <span class="text-blue-400 select-none mr-2">&gt;</span><span class="whitespace-pre-wrap">{text}</span>
</div>
