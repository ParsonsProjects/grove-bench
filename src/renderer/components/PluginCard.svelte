<script lang="ts">
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
        <span class="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 shrink-0">v{version}</span>
        {#if scope}
          <span class="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 shrink-0">{scope}</span>
        {/if}
        {#if installed && !enabled}
          <span class="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 shrink-0">disabled</span>
        {/if}
      </div>
      {#if description}
        <p class="text-xs text-muted-foreground mt-1 line-clamp-2">{description}</p>
      {/if}
      <div class="flex items-center gap-3 mt-1.5">
        {#if marketplace}
          <span class="text-[10px] text-muted-foreground/70">{marketplace}</span>
        {/if}
        {#if installCount != null}
          <span class="text-[10px] text-muted-foreground/70">{formatCount(installCount)} installs</span>
        {/if}
      </div>
    </div>

    <div class="flex items-center gap-1 shrink-0">
      {#if installed}
        {#if enabled}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onclick={() => ondisable?.(installed!.id)}
            class="text-xs h-7 px-2"
          >Disable</Button>
        {:else}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onclick={() => onenable?.(installed!.id)}
            class="text-xs h-7 px-2"
          >Enable</Button>
        {/if}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onclick={() => onuninstall?.(installed!.id)}
          class="text-xs h-7 px-2 text-destructive hover:text-destructive"
        >Remove</Button>
      {:else if available}
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onclick={() => oninstall?.(available!.pluginId)}
          class="text-xs h-7 px-3"
        >Install</Button>
      {/if}
    </div>
  </div>
</div>
