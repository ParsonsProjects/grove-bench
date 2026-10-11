<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";

	/**
	 * The bar along the top of a panel or tab: what it shows on the left,
	 * its actions on the right.
	 */
	let {
		ref = $bindable(null),
		title,
		actions,
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLElement>> & {
		title?: string;
		/** Buttons on the right, usually Button size="icon-2xs" variant="quiet". */
		actions?: Snippet;
	} = $props();
</script>

<header
	bind:this={ref}
	data-slot="panel-header"
	class={cn("flex min-h-8 shrink-0 items-center gap-2 border-b border-border bg-card/50 px-3 py-1 text-xs", className)}
	{...restProps}
>
	<div class="flex min-w-0 flex-1 items-center gap-2">
		{#if title}<span class="truncate font-medium text-foreground">{title}</span>{/if}
		{@render children?.()}
	</div>
	{#if actions}<div class="flex shrink-0 items-center gap-1">{@render actions()}</div>{/if}
</header>
