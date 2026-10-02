<script lang="ts">
  /** Marks something Grove Bench is still testing, such as an alpha agent
   *  (AgentSummary.stage). */
  let { class: className = '' }: { class?: string } = $props();
</script>

<span
  class="inline-flex items-center border border-amber-500/50 px-1 py-px text-[10px] font-medium uppercase leading-none tracking-wide text-amber-500 {className}"
  title="Still being tested: expect rough edges"
>Alpha</span>
