<script lang="ts">
	import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	/**
	 * Pick one of a few views or modes, side by side ("Unified | Split").
	 * A radio group underneath, so arrow keys move between the options and
	 * one is always chosen.
	 */
	let {
		ref = $bindable(null),
		value = $bindable(""),
		orientation = "horizontal",
		class: className,
		...restProps
	}: RadioGroupPrimitive.RootProps = $props();
</script>

<RadioGroupPrimitive.Root
	bind:ref
	bind:value
	{orientation}
	data-slot="segmented"
	class={cn("inline-flex items-stretch border border-border", className)}
	{...restProps}
/>
