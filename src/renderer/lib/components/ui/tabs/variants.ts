import { tv } from "$lib/utils.js";

/** Shared by Tabs.Trigger (active from bits-ui's data-state) and tabTrigger(). */
export const TAB_TRIGGER_BASE =
	"-mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:bg-accent/50 disabled:opacity-50 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3";

/**
 * The tab look for a strip built by hand, where Tabs can't be used (the
 * workspace tabs, whose shortcuts and panels live elsewhere). Prefer Tabs:
 * it gives real tab roles and arrow keys. Pass `active` for the current tab.
 */
export const tabTrigger = tv({
	base: TAB_TRIGGER_BASE,
	variants: {
		active: {
			true: "border-primary text-foreground",
			false: "",
		},
	},
	defaultVariants: { active: false },
});
