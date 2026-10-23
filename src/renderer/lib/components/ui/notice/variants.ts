import { tv, type WithElementRef } from "$lib/utils.js";
import type { HTMLAttributes } from "svelte/elements";
import type { Snippet } from "svelte";
import type { VariantProps } from "tailwind-variants";

/**
 * A message inside a panel or dialog: a failed save, a missing git
 * identity, a tip. Not a toast: it stays until what it describes changes.
 * The tone marks the left edge and the title; the body stays in the
 * normal text colour so it reads easily. Titles use the 300 shade, which
 * keeps 4.5:1 on the tinted background in both themes (400 drops to about
 * 4.1:1 in the light one; light-theme.test.ts checks).
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
			info: { root: "border-blue-400 bg-blue-400/10", title: "text-blue-300" },
			success: { root: "border-green-400 bg-green-400/10", title: "text-green-300" },
			warning: { root: "border-amber-500 bg-amber-500/10", title: "text-amber-300" },
			danger: { root: "border-destructive bg-destructive/10", title: "text-red-300" },
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
