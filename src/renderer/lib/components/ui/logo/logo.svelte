<script lang="ts">
	import { PIXEL_TREE, PIXEL_TREE_W, PIXEL_TREE_H } from "$lib/pixel-tree.js";
	import { cn } from "$lib/utils.js";

	/**
	 * The Grove Bench logo: the pixel tree, with the wordmark beside it when
	 * there is room. BRAND.md has the rules (clear space, smallest size, what
	 * not to do).
	 */
	let {
		height = 13,
		wordmark = false,
		class: className,
	}: {
		/** Tree height in px. Keep it at 13 or more so the 2px leaves stay apart. */
		height?: number;
		/** Show "Grove Bench" in the pixel face beside the tree. */
		wordmark?: boolean;
		class?: string;
	} = $props();

	const width = $derived(Math.round((height * PIXEL_TREE_W) / PIXEL_TREE_H));
</script>

<span data-slot="logo" class={cn("inline-flex items-center gap-1.5", className)} role="img" aria-label="Grove Bench">
	<svg {width} {height} viewBox="0 0 {PIXEL_TREE_W} {PIXEL_TREE_H}" fill="none" class="shrink-0" aria-hidden="true" shape-rendering="crispEdges">
		{#each PIXEL_TREE as p (`${p.x},${p.y}`)}
			<rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />
		{/each}
	</svg>
	{#if wordmark}
		<span class="font-pixel font-semibold leading-none" aria-hidden="true">Grove Bench</span>
	{/if}
</span>
