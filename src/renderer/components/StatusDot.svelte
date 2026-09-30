<script lang="ts">
  import { AGENT_SPRITES, type AgentSpriteState } from '../lib/agent-sprite.js';

  /**
   * A conversation's status as a small square, for when grove characters are
   * off and for lists that show no character (the session finder). It takes
   * the character's colour and label, so both read the same everywhere.
   */
  let { state }: { state: AgentSpriteState } = $props();

  /** Moves only where the character does, and only when the system allows motion. */
  const MOTION: Partial<Record<AgentSpriteState, string>> = {
    working: 'motion-safe:animate-pulse',
    permission: 'motion-safe:animate-pulse',
    starting: 'motion-safe:animate-pulse',
    installing: 'motion-safe:animate-pulse',
    removing: 'motion-safe:animate-pulse',
    unread: 'needs-attention-flash',
  };
  /** Asleep states are hollow, as the character shows closed eyes. */
  const HOLLOW = new Set<AgentSpriteState>(['stopped', 'sleeping']);

  const sprite = $derived(AGENT_SPRITES[state]);
</script>

<span
  class="w-2 h-2 shrink-0 {sprite.colorClass} {HOLLOW.has(state) ? 'border border-current' : 'bg-current'} {MOTION[state] ?? ''}"
  role="img"
  aria-label={sprite.label}
  title={sprite.label}
></span>

<style>
  /* Flash for a conversation that finished a turn while not focused. Steady
     instead when the system asks for reduced motion. */
  @media (prefers-reduced-motion: no-preference) {
    .needs-attention-flash {
      animation: needs-attention-flash 0.8s ease-in-out infinite;
    }
  }
  @keyframes needs-attention-flash {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }
</style>
