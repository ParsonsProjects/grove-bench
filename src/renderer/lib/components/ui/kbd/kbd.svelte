<script lang="ts">
	import { cn } from "$lib/utils.js";
	import { kbdVariants, type KbdProps } from "./variants.js";

	let {
		ref = $bindable(null),
		class: className,
		variant = "plain",
		keys,
		children,
		...restProps
	}: KbdProps = $props();
</script>

<kbd bind:this={ref} data-slot="kbd" class={cn(kbdVariants({ variant }), className)} {...restProps}>
	{#if children}{@render children()}{:else}{keys}{/if}
</kbd>
