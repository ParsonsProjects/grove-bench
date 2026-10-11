import { tv } from "$lib/utils.js";

/**
 * Class recipes for the app's popovers and dropdown menus, which are built
 * by hand in several places (StatusBarPopover, ContextMenu, the pickers).
 * Use these so they look the same; a shared component can replace them
 * later without changing how they look.
 */

/** The floating box: a popover, a dropdown, a context menu. */
export const menuPanel = tv({
	base: "border border-border bg-popover text-xs text-popover-foreground shadow-xl",
	variants: {
		padding: {
			list: "py-1",
			content: "p-3",
		},
	},
	defaultVariants: { padding: "list" },
});

/** One row in a menu or picker. `selected` marks the current choice with
 *  the primary edge, as the agent and model pickers do. */
export const menuItem = tv({
	base: "flex w-full items-center gap-2 border-l-2 border-transparent px-2 py-1 text-left text-xs transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
	variants: {
		selected: {
			true: "border-primary bg-accent/50 text-foreground",
			false: "text-popover-foreground",
		},
		tone: {
			default: "",
			destructive: "text-destructive hover:bg-destructive/10 hover:text-destructive",
		},
	},
	defaultVariants: { selected: false, tone: "default" },
});

/** A heading inside a menu, above a group of rows. */
export const menuLabel = "px-2 pt-2 pb-1 text-micro font-medium tracking-wide text-muted-foreground uppercase";

/** A line between groups of rows. */
export const menuSeparator = "my-1 h-px bg-border";
