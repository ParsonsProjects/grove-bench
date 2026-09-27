<script>
  import Tile from './tiles/Tile.svelte';
  import WorktreesTile from './tiles/WorktreesTile.svelte';
  import ChangesTile from './tiles/ChangesTile.svelte';
  import TerminalTile from './tiles/TerminalTile.svelte';
  import ModesTile from './tiles/ModesTile.svelte';
  import MemoryTile from './tiles/MemoryTile.svelte';
  import PrTile from './tiles/PrTile.svelte';
</script>

<section id="bench" class="border-t border-border scroll-mt-14">
  <div class="max-w-[1140px] mx-auto px-4 sm:px-6 py-20 md:py-28">
    <header class="mb-10 md:mb-14 max-w-2xl">
      <p class="text-xs text-primary font-medium uppercase tracking-wider mb-3">What's inside</p>
      <h2 class="text-2xl md:text-3xl font-bold tracking-tight">The rest of the bench</h2>
      <p class="mt-3 text-sm md:text-base text-muted-foreground leading-relaxed">Six parts of the app, running in miniature.</p>
    </header>

    <div class="bento">
      <Tile class="t-changes" title="Changes" caption="Review every diff, unified or side by side. Revert a file or open it in your editor.">
        <ChangesTile />
      </Tile>
      <Tile class="t-worktrees" title="Worktrees" caption="Each conversation works in its own folder, on its own branch.">
        <WorktreesTile />
      </Tile>
      <Tile class="t-terminal" title="Terminal" caption="A real terminal per conversation, already in its worktree.">
        <TerminalTile />
      </Tile>
      <Tile class="t-modes" title="Permission modes" caption="Choose how much an agent may do before it asks.">
        <ModesTile />
      </Tile>
      <Tile class="t-memory" title="Project memory" caption="Notes per project, read at the start of every conversation.">
        <MemoryTile />
      </Tile>
      <Tile class="t-pr" title="Pull requests" caption="Open a PR from a branch with the GitHub CLI, if you have it.">
        <PrTile />
      </Tile>
    </div>
  </div>
</section>

<style>
  .bento {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
  }
  @media (min-width: 768px) {
    .bento {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-areas:
        'changes changes'
        'worktrees terminal'
        'worktrees modes'
        'memory memory'
        'pr pr';
    }
  }
  @media (min-width: 1024px) {
    .bento {
      grid-template-columns: repeat(6, minmax(0, 1fr));
      grid-template-areas:
        'changes changes changes changes worktrees worktrees'
        'terminal terminal modes modes worktrees worktrees'
        'memory memory memory pr pr pr';
    }
  }
  @media (min-width: 768px) {
    .bento :global(.t-changes) {
      grid-area: changes;
    }
    .bento :global(.t-worktrees) {
      grid-area: worktrees;
    }
    .bento :global(.t-terminal) {
      grid-area: terminal;
    }
    .bento :global(.t-modes) {
      grid-area: modes;
    }
    .bento :global(.t-memory) {
      grid-area: memory;
    }
    .bento :global(.t-pr) {
      grid-area: pr;
    }
  }
</style>
