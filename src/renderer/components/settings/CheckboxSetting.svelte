<script lang="ts">
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';

  /** An on/off setting, with its description under the label. */
  let { setting, label, description, checked = $bindable(false), disabled = false }: {
    setting: string;
    label: string;
    description?: string;
    checked?: boolean;
    disabled?: boolean;
  } = $props();

  const uid = $props.id();
</script>

<div data-setting={setting} class="flex flex-col gap-1">
  <label class="flex items-start gap-2 text-sm text-foreground {disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}">
    <Checkbox
      bind:checked
      {disabled}
      class="mt-0.5"
      aria-describedby={description ? `${uid}-description` : undefined}
    />
    <span>{label}</span>
  </label>
  {#if description}
    <p id="{uid}-description" class="text-xs text-muted-foreground leading-relaxed ml-6">{description}</p>
  {/if}
</div>
