<script lang="ts">
	import { Tabs as TabsPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";
	import { TAB_TRIGGER_BASE } from "./variants.js";

	/** An underlined tab, as in the workspace's Thread / Changes / Terminal row. */
	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: TabsPrimitive.TriggerProps = $props();
</script>

<TabsPrimitive.Trigger
	bind:ref
	data-slot="tabs-trigger"
	class={cn(
		TAB_TRIGGER_BASE,
		"data-[state=active]:border-primary data-[state=active]:text-foreground",
		className
	)}
	{...restProps}
/>
