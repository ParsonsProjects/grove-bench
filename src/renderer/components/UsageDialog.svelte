<script lang="ts">
  /** All threads' usage (UsageReport), opened from the status bar's
   *  activity popup. The same report is the Usage section of Settings. */
  import { usageReportStore } from '../stores/usageReport.svelte.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import UsageReport from './UsageReport.svelte';
</script>

<Dialog.Root open={usageReportStore.open} onOpenChange={(o: boolean) => { usageReportStore.open = o; }}>
  <Dialog.Content class="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>Usage</Dialog.Title>
      <Dialog.Description>Cost, tokens and agent time across every thread and model, removed threads included.</Dialog.Description>
    </Dialog.Header>
    <UsageReport />
  </Dialog.Content>
</Dialog.Root>
