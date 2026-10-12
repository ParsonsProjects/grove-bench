import { tv, type WithElementRef } from "$lib/utils.js";
import type { HTMLAttributes } from "svelte/elements";
import type { Snippet } from "svelte";
import type { VariantProps } from "tailwind-variants";

/**
 * A message inside a panel or dialog: a failed save, a missing git
 * identity, a tip. Not a toast: it stays until what it describes changes.
 * The tone marks the left edge and the title; the body stays in the
 * normal text colour so it reads easily.
 */
export const noticeVariants = tv({
	slots: {
		root: "flex items-start gap-3 border-l-2 px-3 py-2 text-xs",
		title: "font-medium",
		body: "min-w-0 flex-1 space-y-1 text-foreground/90",
		actions: "flex shrink-0 items-center gap-2",
	},
	variants: {
		tone: {
			info: { root: "border-blue-400 bg-blue-400/10", title: "text-blue-400" },
			success: { root: "border-green-400 bg-green-400/10", title: "text-green-400" },
			warning: { root: "border-amber-500 bg-amber-500/10", title: "text-amber-500" },
			danger: { root: "border-destructive bg-destructive/10", title: "text-destructive" },
			neutral: { root: "border-border bg-muted/50", title: "text-foreground" },
		},
	},
	defaultVariants: { tone: "info" },
});

export type NoticeTone = VariantProps<typeof noticeVariants>["tone"];

export type NoticeProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
	tone?: NoticeTone;
	title?: string;
	/** Buttons on the right, such as "Try again". */
	actions?: Snippet;
};
