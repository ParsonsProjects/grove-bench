<script lang="ts">
	import { cn } from "$lib/utils.js";
	import { noticeVariants, type NoticeProps } from "./variants.js";

	let {
		ref = $bindable(null),
		class: className,
		tone = "info",
		title,
		actions,
		children,
		...restProps
	}: NoticeProps = $props();

	const styles = $derived(noticeVariants({ tone }));
</script>

<!-- Errors interrupt a screen reader; everything else waits its turn. -->
<div
	bind:this={ref}
	data-slot="notice"
	role={tone === "danger" ? "alert" : "status"}
	class={cn(styles.root(), className)}
	{...restProps}
>
	<div class={styles.body()}>
		{#if title}<p class={styles.title()}>{title}</p>{/if}
		{@render children?.()}
	</div>
	{#if actions}<div class={styles.actions()}>{@render actions()}</div>{/if}
</div>
