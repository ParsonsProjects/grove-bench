<script lang="ts">
  import { Badge } from '$lib/components/ui/badge/index.js';

  /** Marks something Grove Bench is still testing, such as an alpha agent
   *  (AgentSummary.stage). */
  let { class: className = '' }: { class?: string } = $props();
</script>

<Badge
  tone="warning"
  class="uppercase tracking-wide {className}"
  title="Still being tested: expect rough edges"
>Alpha</Badge>
