<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { prerequisitesStore } from '../stores/prerequisites.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  /** API key entry for one agent. Used by the New Conversation dialog and
   *  Settings > Agent. The saved key never comes back to the renderer; only
   *  whether one is saved. */
  let { adapterId, autofocus = false }: { adapterId: string; autofocus?: boolean } = $props();

  const apiKey = $derived(store.prerequisites?.agents[adapterId]?.apiKey);
  const inputId = $derived(`api-key-${adapterId}`);

  let value = $state('');
  let busy = $state(false);
  let error = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);

  // Svelte's autofocus only fires when nothing has focus, and a dialog has
  // already focused its close button by the time this field shows.
  $effect(() => {
    if (!autofocus || !inputEl) return;
    const frame = requestAnimationFrame(() => inputEl?.focus());
    return () => cancelAnimationFrame(frame);
  });

  async function save() {
    if (!value.trim() || busy) return;
    busy = true;
    error = '';
    try {
      await prerequisitesStore.saveApiKey(adapterId, value);
      value = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await prerequisitesStore.clearApiKey(adapterId);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if apiKey}
  <div class="flex flex-col gap-1">
    <div class="flex items-baseline justify-between">
      <Label for={inputId}>{apiKey.label}</Label>
      <button
        type="button"
        class="text-xs text-primary hover:underline"
        onclick={() => window.groveBench.openExternal(apiKey.helpUrl)}
      >
        Get a key
      </button>
    </div>

    {#if apiKey.canStore}
      <div class="flex items-center gap-2">
        <Input
          id={inputId}
          type="password"
          autocomplete="off"
          spellcheck={false}
          bind:ref={inputEl}
          bind:value
          placeholder={apiKey.saved ? 'Saved. Paste a new key to replace it.' : 'Paste your key'}
          onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') save(); }}
        />
        <Button onclick={save} disabled={!value.trim() || busy}>
          Save key
        </Button>
      </div>
      <p class="text-xs text-muted-foreground">
        {#if apiKey.billingNote}{apiKey.billingNote} {/if}Stored encrypted on this computer. While saved, it is used instead of a CLI sign-in.
      </p>
      {#if apiKey.saved}
        <button
          type="button"
          class="self-start text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
          disabled={busy}
          onclick={remove}
        >
          Remove saved key
        </button>
      {/if}
    {:else}
      <p class="text-xs text-muted-foreground">
        This computer has no secure storage, so the app can't save a key. Sign in from a terminal instead, then re-check.
      </p>
    {/if}

    {#if error}
      <div class="bg-destructive/10 border border-destructive/50 p-2 text-xs text-destructive" role="alert">
        {error}
      </div>
    {/if}
  </div>
{/if}
