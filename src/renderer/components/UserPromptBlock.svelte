<script lang="ts">
  let { text }: { text: string } = $props();
</script>

<div class="py-2 text-sm text-foreground">
  <span class="text-primary select-none mr-2">&gt;</span><span class="whitespace-pre-wrap">{text}</span>
</div>
