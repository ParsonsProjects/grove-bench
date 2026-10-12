<script lang="ts">
	import { cn } from "$lib/utils.js";
	import { badgeVariants, type BadgeProps } from "./variants.js";

	let {
		ref = $bindable(null),
		class: className,
		tone = "neutral",
		variant = "outline",
		count = false,
		children,
		...restProps
	}: BadgeProps = $props();
</script>

<span
	bind:this={ref}
	data-slot="badge"
	class={cn(badgeVariants({ tone, variant, count }), className)}
	{...restProps}
>
	{@render children?.()}
</span>
