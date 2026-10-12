import { tv, type WithElementRef } from "$lib/utils.js";
import type { HTMLAttributes } from "svelte/elements";
import type { VariantProps } from "tailwind-variants";

/**
 * A keyboard shortcut. plain: a quiet hint beside the thing it opens
 * ("Ctrl+R" in the search box); key: a keycap, for lists of shortcuts.
 */
export const kbdVariants = tv({
	base: "font-mono text-micro leading-none whitespace-nowrap",
	variants: {
		variant: {
			plain: "text-muted-foreground",
			key: "inline-flex h-4 min-w-4 items-center justify-center border border-border bg-muted/40 px-1 text-muted-foreground",
		},
	},
	defaultVariants: { variant: "plain" },
});

export type KbdVariant = VariantProps<typeof kbdVariants>["variant"];

export type KbdProps = WithElementRef<HTMLAttributes<HTMLElement>> & {
	variant?: KbdVariant;
	/** The shortcut as text, such as "Ctrl+R". Children win if both are given. */
	keys?: string;
};
