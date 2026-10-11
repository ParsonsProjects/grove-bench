<script lang="ts">
	import { cn } from "$lib/utils.js";
	import { pulseVariants, type PulseMotion, type PulseSize, type PulseTone } from "./variants.js";

	let {
		tone = "working",
		size = "md",
		motion = "pulse",
		label,
		class: className,
	}: {
		tone?: PulseTone;
		size?: PulseSize;
		motion?: PulseMotion;
		/** What it means, for screen readers. Leave out when text beside it says. */
		label?: string;
		class?: string;
	} = $props();
</script>

<span
	data-slot="pulse"
	class={cn(pulseVariants({ tone, size, motion }), className)}
	role={label ? "img" : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : "true"}
></span>
