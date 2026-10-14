<script lang="ts">
  import { agentsStore } from '../stores/agents.svelte.js';
  import { backgroundAgentStore } from '../stores/background-agent.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  /** Asks which agent runs a background task for a thread whose own agent
   *  is gone (backgroundAgentStore). Nothing is sent until the user picks. */
  const ask = $derived(backgroundAgentStore.ask);
  const choices = $derived(agentsStore.offered(settingsStore.current.enabledAlphaAgents));
  let picked = $state('');
  // Start on the default agent each time a question opens.
  $effect(() => {
    if (ask) picked = choices.some((a) => a.id === agentsStore.defaultId) ? agentsStore.defaultId! : (choices[0]?.id ?? '');
  });
  const pickedName = $derived(agentsStore.get(picked)?.displayName ?? '');
</script>

{#if ask}
  <Dialog.Root open onOpenChange={(o) => { if (!o) backgroundAgentStore.answer(null); }}>
    <Dialog.Content class="sm:max-w-md">
      <Dialog.Header>
        <Dialog.Title>Pick an agent for this</Dialog.Title>
        <Dialog.Description>
          This thread ran on <code class="text-foreground">{ask.agentId}</code>, which isn't set up any more. To {ask.task}, Grove Bench needs to send the thread's content to another agent. It asks once per thread until you restart.
        </Dialog.Description>
      </Dialog.Header>
      {#if choices.length > 0}
        <div class="flex flex-col gap-1.5">
          <Label for="background-agent">Agent</Label>
          <Select.Root type="single" value={picked} onValueChange={(v) => { if (v) picked = v; }}>
            <Select.Trigger id="background-agent" class="w-64">{pickedName}</Select.Trigger>
            <Select.Content>
              {#each choices as choice (choice.id)}
                <Select.Item value={choice.id} label={choice.displayName} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      {:else}
        <p class="text-xs text-muted-foreground">No other agent is set up.</p>
      {/if}
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => backgroundAgentStore.answer(null)}>Cancel</Button>
        <Button disabled={!picked} onclick={() => backgroundAgentStore.answer(picked)}>Use {pickedName || 'agent'}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
