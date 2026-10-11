import { tv } from "$lib/utils.js";
import type { VariantProps } from "tailwind-variants";

/**
 * A small square that shows something is happening: a tool running, a
 * thread working. Square, not a round spinner, to match the pixel art.
 * Both motions stop when the system asks for reduced motion (globals.css);
 * the colour still carries the meaning.
 */
export const pulseVariants = tv({
	base: "inline-block shrink-0",
	variants: {
		tone: {
			working: "bg-status-working",
			attention: "bg-status-attention",
			unread: "bg-status-unread",
			error: "bg-status-error",
			primary: "bg-primary",
			muted: "bg-muted-foreground",
			// The text colour around it: inside a filled button, for example.
			current: "bg-current",
		},
		size: {
			xs: "size-1.5",
			sm: "size-2",
			md: "size-2.5",
		},
		motion: {
			pulse: "animate-pulse",
			spin: "animate-fidget",
			none: "",
		},
	},
	defaultVariants: { tone: "working", size: "md", motion: "pulse" },
});

export type PulseTone = VariantProps<typeof pulseVariants>["tone"];
export type PulseSize = VariantProps<typeof pulseVariants>["size"];
export type PulseMotion = VariantProps<typeof pulseVariants>["motion"];
