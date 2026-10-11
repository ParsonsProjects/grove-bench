<script lang="ts">
	import { Tabs as TabsPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

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
		"-mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:bg-accent/50 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-primary data-[state=active]:text-foreground [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
		className
	)}
	{...restProps}
/>
