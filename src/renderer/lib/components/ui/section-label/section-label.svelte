<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	/**
	 * The small uppercase heading over a group of rows ("THREADS", "MODEL").
	 * Full muted colour, not faded, so it keeps 4.5:1 contrast.
	 */
	let {
		ref = $bindable(null),
		as = "div",
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLElement>> & {
		/** A heading level when the label starts a section of the page. */
		as?: "div" | "span" | "h2" | "h3" | "h4" | "legend";
	} = $props();
</script>

<svelte:element
	this={as}
	bind:this={ref}
	data-slot="section-label"
	class={cn("text-micro font-medium tracking-wide text-muted-foreground uppercase", className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
