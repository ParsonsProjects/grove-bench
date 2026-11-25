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
		wrap = false,
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		title?: string;
		/** Buttons on the right, usually Button size="icon-2xs" variant="quiet". */
		actions?: Snippet;
		/** For wide actions (several controls): when they don't fit beside the
		 *  title, they move to a row of their own, and wrap there too, rather
		 *  than squeezing the title or running past the edge. */
		wrap?: boolean;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="panel-header"
	class={cn("flex min-h-8 shrink-0 items-center gap-2 border-b border-border bg-card/50 px-3 py-1 text-xs", wrap && "flex-wrap gap-y-1", className)}
	{...restProps}
>
	<div class={cn("flex min-w-0 flex-1 items-center gap-2", wrap && "basis-auto")}>
		{#if title}<span class="truncate font-medium text-foreground">{title}</span>{/if}
		{@render children?.()}
	</div>
	{#if actions}
		<div class={cn("flex shrink-0 items-center gap-1", wrap && "ml-auto min-w-0 shrink flex-wrap justify-end gap-y-1")}>{@render actions()}</div>
	{/if}
</div>
