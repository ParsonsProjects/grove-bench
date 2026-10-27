<script lang="ts">
  /**
   * Dev builds only: a bar under the new thread screen to switch between the
   * prototypes in draft-prototype.svelte.ts.
   */
  import { DRAFT_PROTOTYPES, draftPrototype, type DraftPrototypeKey } from '$lib/draft-prototype.svelte.js';

  const keys = Object.keys(DRAFT_PROTOTYPES) as DraftPrototypeKey[];
  const labels: Record<DraftPrototypeKey, string> = { footer: 'Footer', picker: 'Picker', copy: 'Copy', discard: 'Discard' };
</script>

<div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 border-t border-dashed border-amber-500/50 text-caption text-muted-foreground" data-testid="draft-prototype-bar">
  <span class="text-amber-500 font-medium">Prototype</span>
  {#each keys as key (key)}
    <label class="flex items-center gap-1.5">
      {labels[key]}
      <select
        class="bg-background border border-input px-1 py-0.5 text-caption text-foreground"
        value={draftPrototype.current[key]}
        title={(DRAFT_PROTOTYPES[key] as Record<string, string>)[draftPrototype.current[key]]}
        onchange={(e) => draftPrototype.set(key, e.currentTarget.value as never)}
      >
        {#each Object.entries(DRAFT_PROTOTYPES[key]) as [value, description] (value)}
          <option {value} title={description}>{value}</option>
        {/each}
      </select>
    </label>
  {/each}
</div>
