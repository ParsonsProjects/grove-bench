<script lang="ts">
	import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import type { Snippet } from "svelte";
	import { SEGMENTED_ITEM_BASE } from "./variants.js";

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
		SEGMENTED_ITEM_BASE,
		"data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</RadioGroupPrimitive.Item>
