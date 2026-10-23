import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { createTV } from "tailwind-variants";

/** The theme's own font sizes (text-micro, text-caption in globals.css).
 *  Without this, tailwind-merge reads them as text colours and drops one
 *  when a real colour follows: cn('text-micro text-muted-foreground') would
 *  lose text-micro. */
const TW_MERGE_CONFIG = { extend: { theme: { text: ["micro", "caption"] } } };

const twMerge = extendTailwindMerge(TW_MERGE_CONFIG);

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/** tailwind-variants with the same merge rules as cn(). UI components import
 *  tv from here, not from tailwind-variants. */
export const tv = createTV({ twMergeConfig: TW_MERGE_CONFIG });

export function prefersReducedMotion(): boolean {
	try {
		return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
	} catch {
		return false;
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
