<script lang="ts">
	import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import type { Snippet } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChildrenOrChild<RadioGroupPrimitive.ItemProps> & { children?: Snippet } = $props();
</script>

<RadioGroupPrimitive.Item
	bind:ref
	data-slot="segmented-item"
	class={cn(
		"inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap text-muted-foreground transition-colors outline-none not-first:border-l not-first:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</RadioGroupPrimitive.Item>
