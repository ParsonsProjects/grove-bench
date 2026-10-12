import { tv } from "$lib/utils.js";

/** Shared by Segmented.Item (chosen from bits-ui's data-state) and segmentedItem(). */
export const SEGMENTED_ITEM_BASE =
	"inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap text-muted-foreground transition-colors outline-none not-first:border-l not-first:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:opacity-50 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3";

/** The box around a segmented control built by hand. */
export const segmentedRoot = "inline-flex items-stretch border border-border";

/**
 * One option of a segmented control built by hand, where Segmented can't be
 * used. Prefer Segmented: it is a real radio group. Pass `selected` for the
 * chosen option.
 */
export const segmentedItem = tv({
	base: SEGMENTED_ITEM_BASE,
	variants: {
		selected: {
			true: "bg-accent text-accent-foreground",
			false: "",
		},
	},
	defaultVariants: { selected: false },
});
