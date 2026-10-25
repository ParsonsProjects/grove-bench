<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn } from "$lib/utils.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import type { ButtonSize, ButtonVariant } from "$lib/components/ui/button/button.svelte";

	/** Asks before an action that discards something, in place of the
	 *  buttons that started it: the question, then Cancel and the action. */
	let {
		class: className,
		message,
		confirm,
		variant = "destructive",
		size = "xs",
		busy = false,
		disabled = false,
		stretch = false,
		onconfirm,
		oncancel,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & {
		/** What the action does and what it discards. */
		message: string;
		/** The action's label. */
		confirm: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		/** The action is running: neither button can be pressed. */
		busy?: boolean;
		/** The action can't run now; Cancel still can. */
		disabled?: boolean;
		/** The two buttons share the width (a narrow popover). */
		stretch?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();
</script>

<div data-slot="confirm" class={cn("flex flex-wrap items-center gap-2", className)} {...restProps}>
	<!-- Announced at once: it appeared because of what the user just pressed. -->
	<p class="basis-full text-xs text-foreground" role="alert">{message}</p>
	<Button variant="subtle" {size} class={cn(stretch && "flex-1")} disabled={busy} onclick={oncancel}>Cancel</Button>
	<Button {variant} {size} class={cn(stretch && "flex-1", "disabled:cursor-not-allowed")} disabled={busy || disabled} onclick={onconfirm}>
		{confirm}
	</Button>
</div>
