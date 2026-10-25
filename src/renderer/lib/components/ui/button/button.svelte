<script lang="ts" module>
	import { cn, tv, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
	import type { VariantProps } from "tailwind-variants";

	export const buttonVariants = tv({
		base: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex shrink-0 items-center justify-center gap-2 text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-primary/90",
				destructive:
					"bg-destructive hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60 text-destructive-foreground",
				secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
				link: "text-primary underline-offset-4 hover:underline disabled:hover:no-underline",
				// A link that opens a web page or another app: blue goes, green acts.
				external: "text-link underline-offset-4 hover:underline disabled:hover:no-underline",
				// Grove's own (docs/ui-kit.md). subtle: the bordered toolbar
				// button; quiet: an icon or text that only brightens on hover.
				subtle: "border border-border text-muted-foreground hover:text-foreground hover:bg-accent disabled:hover:text-muted-foreground disabled:hover:bg-transparent",
				// The main action of a group (a row, a section's header): subtle's
				// border, in green. A view's one main action is default.
				"subtle-primary": "border border-border text-primary hover:bg-accent disabled:hover:bg-transparent",
				quiet: "text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground",
				// An icon that deletes, closes for good or stops: quiet until hovered.
				"quiet-destructive": "text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:hover:text-muted-foreground disabled:hover:bg-transparent",
				"outline-destructive": "border border-destructive/60 text-destructive hover:bg-destructive/10",
				// Allowing something the agent asked for: done-green, not brand green.
				"outline-success": "border border-green-400/60 text-green-400 hover:bg-green-400/10",
			},
			size: {
				default: "h-9 px-4 py-2 has-[>svg]:px-3",
				sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
				// The app's dense sizes: xs (24px) for toolbars and dialogs'
				// secondary actions, 2xs (20px) for status-bar and inline actions.
				xs: "h-6 gap-1 px-2 text-xs font-normal has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3.5",
				"2xs": "h-5 gap-1 px-1.5 text-micro font-normal [&_svg:not([class*='size-'])]:size-3",
				// As tall as default: icon-only buttons beside a 36px field (the
				// composer's send and stop).
				icon: "size-9",
				// As tall as sm: icon-only buttons in a row of sm buttons or
				// beside a 32px field (the plan and question replies).
				"icon-sm": "size-8",
				"icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3.5",
				"icon-2xs": "size-5 [&_svg:not([class*='size-'])]:size-3",
				// Sits in a line of text: no box, the text's own size.
				inline: "h-auto gap-1 p-0 text-[length:inherit] font-normal [&_svg:not([class*='size-'])]:size-3",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
	export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = "default",
		size = "default",
		ref = $bindable(null),
		href = undefined,
		type = "button",
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? "link" : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
