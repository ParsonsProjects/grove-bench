import { tv } from './utils.js';

/**
 * The status bar's lozenges: each part of the bar (agent, activity, branch,
 * MCP and Skills) is one bordered, one-line chip that opens its popover.
 * Square like the rest of the app. `tone: 'attention'` fills it amber while
 * it needs you; `open` marks the one whose popover is showing.
 */
export const lozenge = tv({
  base: 'relative inline-flex h-5 min-w-0 shrink-0 items-center gap-1.5 border px-1.5 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:shrink-0',
  variants: {
    tone: {
      default: 'border-input text-muted-foreground hover:bg-accent hover:text-foreground',
      attention: 'border-status-attention/50 bg-status-attention/10 text-status-attention hover:bg-status-attention/20',
    },
    open: {
      true: 'bg-accent text-foreground',
      false: '',
    },
  },
  defaultVariants: { tone: 'default', open: false },
});

/** The square on a lozenge's top right corner: green when its popover holds
 *  something for you to do, amber for a warning. The ring cuts it out of
 *  the lozenge's border. Decorative: the lozenge's label says it in words. */
export const lozengeMark = tv({
  base: 'pointer-events-none absolute -top-1 -right-1 size-1.5 ring-2 ring-card',
  variants: {
    tone: {
      action: 'bg-primary',
      warning: 'bg-status-attention',
    },
  },
  defaultVariants: { tone: 'action' },
});
