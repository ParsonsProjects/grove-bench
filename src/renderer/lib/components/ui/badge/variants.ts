import { tv, type WithElementRef } from "$lib/utils.js";
import type { HTMLAttributes } from "svelte/elements";
import type { VariantProps } from "tailwind-variants";

/**
 * A small square label: a count, a state ("alpha", "read-only"), a file
 * kind. Outline is the default. Solid is for counts that need to stand
 * out and only comes in neutral, muted, primary and danger.
 */
export const badgeVariants = tv({
	base: "inline-flex shrink-0 items-center gap-1 border px-1 py-px text-micro leading-none font-medium whitespace-nowrap [&_svg]:size-2.5 [&_svg]:shrink-0",
	variants: {
		tone: {
			neutral: "text-foreground/80 border-border",
			muted: "text-muted-foreground border-border",
			primary: "text-primary border-primary/40",
			info: "text-blue-400 border-blue-400/40",
			success: "text-green-400 border-green-400/40",
			warning: "text-amber-500 border-amber-500/50",
			danger: "text-red-400 border-red-400/50",
			accent: "text-purple-400 border-purple-400/50",
			highlight: "text-cyan-400 border-cyan-400/50",
		},
		variant: {
			outline: "",
			soft: "border-transparent bg-current/10",
			solid: "border-transparent font-bold",
		},
		count: {
			true: "min-w-4 justify-center tabular-nums",
			false: "",
		},
	},
	compoundVariants: [
		{ variant: "solid", tone: "neutral", class: "bg-secondary text-secondary-foreground" },
		{ variant: "solid", tone: "muted", class: "bg-muted text-muted-foreground" },
		{ variant: "solid", tone: "primary", class: "bg-primary text-primary-foreground" },
		{ variant: "solid", tone: "danger", class: "bg-destructive text-destructive-foreground" },
	],
	defaultVariants: { tone: "neutral", variant: "outline", count: false },
});

export type BadgeTone = VariantProps<typeof badgeVariants>["tone"];
export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

export type BadgeProps = WithElementRef<HTMLAttributes<HTMLSpanElement>> & {
	tone?: BadgeTone;
	variant?: BadgeVariant;
	/** A number: centred, at least square, digits the same width. */
	count?: boolean;
};
