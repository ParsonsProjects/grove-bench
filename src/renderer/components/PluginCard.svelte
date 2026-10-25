<script lang="ts">
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import type { InstalledPlugin, AvailablePlugin } from '../../shared/types.js';

  interface Props {
    installed?: InstalledPlugin;
    available?: AvailablePlugin;
    busy: boolean;
    oninstall?: (pluginId: string) => void;
    onuninstall?: (pluginId: string) => void;
    onenable?: (pluginId: string) => void;
    ondisable?: (pluginId: string) => void;
  }

  let { installed, available, busy, oninstall, onuninstall, onenable, ondisable }: Props = $props();

  const name = $derived(installed ? installed.id.split('@')[0] : available?.name ?? '');
  const description = $derived(available?.description ?? '');
  const marketplace = $derived(installed ? installed.id.split('@')[1] : available?.marketplaceName ?? '');
  const version = $derived(installed?.version ?? available?.version ?? '');
  const scope = $derived(installed?.scope);
  const enabled = $derived(installed?.enabled ?? true);
  const installCount = $derived(available?.installCount);

  /** Remove asks once more before uninstalling. */
  let confirmingRemove = $state(false);

  function formatCount(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }
</script>

<div class="border border-border p-3 flex flex-col gap-2 bg-card">
  <div class="flex items-start justify-between gap-2">
    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-foreground truncate">{name}</span>
        <Badge tone="muted" variant="solid">v{version}</Badge>
        {#if scope}
          <Badge tone="muted" variant="solid">{scope}</Badge>
        {/if}
        {#if installed && !enabled}
          <Badge tone="warning" variant="soft">disabled</Badge>
        {/if}
      </div>
      {#if description}
        <p class="text-xs text-muted-foreground mt-1 line-clamp-2">{description}</p>
      {/if}
      <div class="flex items-center gap-3 mt-1.5">
        {#if marketplace}
          <span class="text-xs text-muted-foreground">{marketplace}</span>
        {/if}
        {#if installCount != null}
          <span class="text-xs text-muted-foreground">{formatCount(installCount)} installs</span>
        {/if}
      </div>
    </div>

    <div class="flex items-center gap-1 shrink-0">
      {#if installed && confirmingRemove}
        <span class="text-xs text-foreground">Remove {name}?</span>
        <Button
          variant="destructive"
          size="xs"
          disabled={busy}
          onclick={() => { confirmingRemove = false; onuninstall?.(installed!.id); }}
        >Remove</Button>
        <Button
          variant="quiet"
          size="xs"
          onclick={() => (confirmingRemove = false)}
        >Cancel</Button>
      {:else if installed}
        {#if enabled}
          <Button
            variant="quiet"
            size="xs"
            disabled={busy}
            onclick={() => ondisable?.(installed!.id)}
          >Disable</Button>
        {:else}
          <Button
            variant="subtle-primary"
            size="xs"
            disabled={busy}
            onclick={() => onenable?.(installed!.id)}
          >Enable</Button>
        {/if}
        <Button
          variant="outline-destructive"
          size="xs"
          disabled={busy}
          onclick={() => (confirmingRemove = true)}
        >Remove</Button>
      {:else if available}
        <Button
          variant="subtle-primary"
          size="xs"
          disabled={busy}
          onclick={() => oninstall?.(available!.pluginId)}
        >Install</Button>
      {/if}
    </div>
  </div>
</div>
