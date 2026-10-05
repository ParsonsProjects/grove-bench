<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { PERFORMANCE_TRACE_SECONDS } from '../../../shared/types.js';
  import { perfTraceStore } from '../../stores/perfTrace.svelte.js';
  import SettingRow from './SettingRow.svelte';
  import SettingsGroup from './SettingsGroup.svelte';

  // A countdown while the trace records.
  let now = $state(Date.now());
  $effect(() => {
    if (perfTraceStore.state !== 'recording') return;
    now = Date.now();
    const timer = setInterval(() => { now = Date.now(); }, 250);
    return () => clearInterval(timer);
  });
  const secondsLeft = $derived(Math.max(1, PERFORMANCE_TRACE_SECONDS - Math.floor((now - perfTraceStore.startedAt) / 1000)));

  const sizeMb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
</script>

<SettingsGroup>
  <SettingRow
    setting="performance-log"
    label="Performance log"
    description="Freezes, how long each new thread, resume and wake took step by step, and a summary every 10 minutes are written to performance.log in the logs folder. It stays on this computer; send it along when reporting something slow."
  >
    <div>
      <Button size="sm" variant="outline" onclick={() => window.groveBench.showPerformanceFile('log')}>Show performance log</Button>
    </div>
  </SettingRow>

  <SettingRow
    setting="performance-trace"
    label="Record a performance trace"
    description="Records what every part of the app does for {PERFORMANCE_TRACE_SECONDS} seconds and saves it as a file. Start it, then do the slow thing, such as starting a new thread. Open the file at ui.perfetto.dev or in chrome://tracing. It stays on this computer; it holds timings, file paths and page addresses, not thread text. The newest 5 are kept."
  >
    <div class="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onclick={() => perfTraceStore.record()} disabled={perfTraceStore.state === 'recording'}>
        {perfTraceStore.state === 'recording' ? `Recording... ${secondsLeft} s` : `Record ${PERFORMANCE_TRACE_SECONDS} seconds`}
      </Button>
      <span class="text-xs text-muted-foreground" aria-live="polite">
        {#if perfTraceStore.state === 'saved' && perfTraceStore.result}
          Saved {perfTraceStore.result.name} ({sizeMb(perfTraceStore.result.sizeBytes)} MB).
        {:else if perfTraceStore.state === 'error'}
          <span class="text-destructive">Couldn't record a trace: {perfTraceStore.error}</span>
        {/if}
      </span>
      {#if perfTraceStore.state === 'saved'}
        <Button size="sm" variant="ghost" onclick={() => window.groveBench.showPerformanceFile('trace')}>Show in folder</Button>
      {/if}
    </div>
  </SettingRow>
</SettingsGroup>
