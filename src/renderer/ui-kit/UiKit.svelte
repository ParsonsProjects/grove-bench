<script lang="ts">
  /**
   * The living UI kit: the brand colours and every shared component, drawn by
   * the real code so it can't drift from the app. docs/ui-kit.md explains
   * when to use each; this page shows what they look like. Open
   * /ui-kit.html on the dev server.
   */
  import { NIGHT, PALETTE, PAPER, STATUS } from '../../shared/brand.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Kbd } from '$lib/components/ui/kbd/index.js';
  import { Logo } from '$lib/components/ui/logo/index.js';
  import { menuItem, menuLabel, menuPanel, menuSeparator } from '$lib/components/ui/menu/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { PanelHeader } from '$lib/components/ui/panel-header/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import * as Segmented from '$lib/components/ui/segmented/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import StatusDot from '../components/StatusDot.svelte';
  import type { AgentSpriteState } from '$lib/agent-sprite.js';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
  import XIcon from '@lucide/svelte/icons/x';

  const brandSwatches = Object.entries(PALETTE) as [string, string][];
  const nightSwatches = Object.entries(NIGHT) as [string, string][];
  const paperSwatches = Object.entries(PAPER) as [string, string][];

  /** Theme tokens as the current theme draws them. */
  const tokens = ['background', 'card', 'muted', 'accent', 'border', 'input', 'primary', 'destructive', 'foreground', 'muted-foreground'];

  const buttonVariants = ['default', 'secondary', 'subtle', 'quiet', 'quiet-destructive', 'outline-success', 'outline-destructive', 'destructive', 'link', 'external'] as const;
  const buttonSizes = ['2xs', 'xs', 'sm', 'default'] as const;
  const badgeTones = ['neutral', 'muted', 'primary', 'info', 'success', 'warning', 'danger', 'accent', 'highlight'] as const;
  const noticeTones = ['info', 'success', 'warning', 'danger', 'neutral'] as const;
  const statusStates: AgentSpriteState[] = ['permission', 'working', 'unread', 'error', 'ready', 'sleeping', 'stopped'];

  const typeScale = [
    { cls: 'text-micro', name: 'micro', px: 10, use: 'Counts, badges, key hints' },
    { cls: 'text-caption', name: 'caption', px: 11, use: 'Secondary details: times, paths' },
    { cls: 'text-xs', name: 'xs', px: 12, use: 'Default UI text: rows, buttons, menus' },
    { cls: 'text-sm', name: 'sm', px: 14, use: 'Reading: messages, the prompt' },
    { cls: 'text-base', name: 'base', px: 16, use: 'Panel titles' },
  ];

  let tab = $state('thread');
  let view = $state('unified');
  let checked = $state(true);
</script>

<div class="min-h-screen bg-background text-foreground">
  <div class="mx-auto max-w-5xl space-y-12 px-6 py-10">
    <header class="space-y-3">
      <Logo height={48} wordmark class="text-3xl text-foreground" />
      <p class="max-w-2xl text-sm text-muted-foreground">
        The brand colours and shared components, drawn by the app's own code.
        <code class="text-foreground">docs/ui-kit.md</code> says when to use each one. This page follows your
        system's light or dark setting.
      </p>
    </header>

    <!-- Colour -->
    <section class="space-y-4">
      <h2 class="font-pixel text-xl">Colour</h2>

      <div class="space-y-2">
        <SectionLabel as="h3">Brand palette</SectionLabel>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {#each brandSwatches as [name, hex] (name)}
            <div class="border border-border">
              <div class="h-10" style:background={hex}></div>
              <div class="px-2 py-1 text-caption">
                <div class="text-foreground">{name}</div>
                <div class="text-muted-foreground">{hex}</div>
              </div>
            </div>
          {/each}
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        {#each [['Night (dark theme)', nightSwatches], ['Paper (light theme)', paperSwatches]] as [label, swatches] (label)}
          <div class="space-y-2">
            <SectionLabel as="h3">{label}</SectionLabel>
            <div class="grid grid-cols-4 gap-1">
              {#each swatches as [name, hex] (name)}
                <div class="border border-border">
                  <div class="h-6" style:background={hex}></div>
                  <div class="truncate px-1.5 py-0.5 text-micro text-muted-foreground">{name}</div>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>

      <div class="space-y-2">
        <SectionLabel as="h3">Theme tokens, as this theme draws them</SectionLabel>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {#each tokens as token (token)}
            <div class="flex items-center gap-2 text-caption">
              <span class="size-5 shrink-0 border border-border" style:background="var(--{token})"></span>
              <span class="truncate">--{token}</span>
            </div>
          {/each}
        </div>
      </div>

      <div class="space-y-2">
        <SectionLabel as="h3">Thread status</SectionLabel>
        <div class="flex flex-wrap gap-x-6 gap-y-2 text-xs">
          {#each Object.entries(STATUS) as [tone, s] (tone)}
            <span class="flex items-center gap-2">
              <Pulse tone={tone as keyof typeof STATUS} size="sm" motion="none" />
              <span style:color="var(--status-{tone})">{s.label}</span>
              <span class="text-micro text-muted-foreground">--status-{tone}</span>
            </span>
          {/each}
        </div>
        <div class="flex flex-wrap items-center gap-4 text-caption text-muted-foreground">
          {#each statusStates as state (state)}
            <span class="flex items-center gap-1.5"><StatusDot {state} /> {state}</span>
          {/each}
        </div>
      </div>
    </section>

    <!-- Type -->
    <section class="space-y-4">
      <h2 class="font-pixel text-xl">Type</h2>
      <div class="grid gap-6 md:grid-cols-2">
        <div class="space-y-2">
          <SectionLabel as="h3">JetBrains Mono: everything</SectionLabel>
          {#each typeScale as t (t.name)}
            <div class="flex items-baseline gap-3 border-b border-border pb-1.5">
              <span class="w-16 shrink-0 text-micro text-muted-foreground">{t.name} {t.px}</span>
              <span class="{t.cls} min-w-0">{t.use}</span>
            </div>
          {/each}
          <p class="text-caption text-muted-foreground">Weights: 400 normal, 500 medium for labels and buttons, 700 bold for counts.</p>
        </div>
        <div class="space-y-3">
          <SectionLabel as="h3">Pixelify Sans: brand moments only</SectionLabel>
          <p class="font-pixel text-3xl leading-tight">Grove Bench</p>
          <p class="font-pixel text-xl">Nothing growing yet</p>
          <p class="text-caption text-muted-foreground">The wordmark, empty-state titles and the landing page. Never for body text, buttons or anything below 16px.</p>
        </div>
      </div>
    </section>

    <!-- Buttons -->
    <section class="space-y-4">
      <h2 class="font-pixel text-xl">Buttons</h2>
      <div class="overflow-x-auto">
        <table class="text-xs">
          <thead>
            <tr>
              <th></th>
              {#each buttonSizes as size (size)}
                <th class="px-3 pb-2 text-left text-micro font-medium tracking-wide text-muted-foreground uppercase">{size}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each buttonVariants as variant (variant)}
              <tr>
                <td class="pr-4 text-caption text-muted-foreground">{variant}</td>
                {#each buttonSizes as size (size)}
                  <td class="px-3 py-1.5"><Button {variant} {size}>{variant === 'link' ? 'Try again' : variant === 'external' ? 'Open on GitHub' : 'Create PR'}</Button></td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <SectionLabel>Icon sizes</SectionLabel>
        <Button size="icon-2xs" variant="quiet" aria-label="Close"><XIcon /></Button>
        <Button size="icon-xs" variant="quiet" aria-label="Refresh"><RefreshIcon /></Button>
        <Button size="icon-xs" variant="subtle" aria-label="Refresh"><RefreshIcon /></Button>
        <Button size="icon-sm" variant="subtle" aria-label="Send"><ArrowUpIcon /></Button>
        <Button size="icon" aria-label="Send"><ArrowUpIcon /></Button>
        
        <span class="text-xs">An inline <Button size="inline" variant="link">action</Button> in a sentence.</span>
      </div>
    </section>

    <!-- Labels -->
    <section class="space-y-4">
      <h2 class="font-pixel text-xl">Badges and keys</h2>
      <div class="space-y-2">
        {#each ['outline', 'soft'] as const as variant (variant)}
          <div class="flex flex-wrap items-center gap-2">
            <span class="w-16 text-caption text-muted-foreground">{variant}</span>
            {#each badgeTones as tone (tone)}<Badge {tone} {variant}>{tone}</Badge>{/each}
          </div>
        {/each}
        <div class="flex flex-wrap items-center gap-2">
          <span class="w-16 text-caption text-muted-foreground">solid</span>
          <Badge tone="primary" variant="solid" count>4</Badge>
          <Badge tone="neutral" variant="solid" count>12</Badge>
          <Badge tone="muted" variant="solid">main</Badge>
          <Badge tone="danger" variant="solid" count>2</Badge>
          <Badge tone="warning">alpha</Badge>
        </div>
        <div class="flex flex-wrap items-center gap-4">
          <span class="w-16 text-caption text-muted-foreground">keys</span>
          <span class="flex items-center gap-2 text-xs">Search threads <Kbd keys="Ctrl+R" /></span>
          <span class="flex items-center gap-1"><Kbd variant="key">Ctrl</Kbd><Kbd variant="key">K</Kbd></span>
          <span class="flex items-center gap-1"><Kbd variant="key">↑</Kbd><Kbd variant="key">↓</Kbd><Kbd variant="key">Enter</Kbd></span>
        </div>
      </div>
    </section>

    <!-- Navigation -->
    <section class="space-y-4">
      <h2 class="font-pixel text-xl">Tabs and choices</h2>
      <div class="border border-border">
        <Tabs.Root bind:value={tab}>
          <Tabs.List aria-label="Workspace">
            <Tabs.Trigger value="thread">Thread <Pulse size="sm" /></Tabs.Trigger>
            <Tabs.Trigger value="changes">Changes <Badge tone="primary" variant="solid" count>4</Badge></Tabs.Trigger>
            <Tabs.Trigger value="terminal">Terminal <Kbd keys="Alt+4" /></Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="thread" class="p-3 text-xs text-muted-foreground">The agent's messages and tool calls.</Tabs.Content>
          <Tabs.Content value="changes" class="p-3 text-xs text-muted-foreground">Four files changed in this worktree.</Tabs.Content>
          <Tabs.Content value="terminal" class="p-3 text-xs text-muted-foreground">A shell in the worktree.</Tabs.Content>
        </Tabs.Root>
      </div>
      <div class="flex flex-wrap items-center gap-6">
        <Segmented.Root bind:value={view} aria-label="Diff view">
          <Segmented.Item value="unified">Unified</Segmented.Item>
          <Segmented.Item value="split">Split</Segmented.Item>
        </Segmented.Root>
        <label class="flex items-center gap-2 text-xs"><Checkbox bind:checked /> Show grove characters</label>
        <Input class="h-7 w-56 text-xs" placeholder="Search threads..." />
      </div>
      <Textarea class="text-sm" placeholder="Message (Enter to send)" rows={2} />
    </section>

    <!-- Feedback -->
    <section class="space-y-4">
      <h2 class="font-pixel text-xl">Notices and activity</h2>
      <div class="grid gap-2 md:grid-cols-2">
        {#each noticeTones as tone (tone)}
          <Notice {tone} title={{ info: 'Tip', success: 'Pushed', warning: 'No git identity', danger: "Couldn't save settings", neutral: 'Nothing to review' }[tone]}>
            {#snippet actions()}{#if tone === 'danger'}<Button size="2xs" variant="link">Try again</Button>{/if}{/snippet}
            <p>{{ info: 'Ctrl+R finds any thread, open or closed.', success: 'claude/sidebar-revamp is on GitHub.', warning: "Git doesn't have your name and email for this project, so it will likely refuse the agent's commits.", danger: 'settings.json is read-only. Check its permissions and try again.', neutral: 'This worktree has no changes yet.' }[tone]}</p>
          </Notice>
        {/each}
      </div>
      <div class="flex flex-wrap items-center gap-6 text-xs">
        <span class="flex items-center gap-2"><Pulse /> Running npm test</span>
        <span class="flex items-center gap-2"><Pulse motion="spin" /> Writing</span>
        <span class="flex items-center gap-2"><Pulse tone="attention" size="sm" /> Waiting for you</span>
        <span class="flex items-center gap-2"><Pulse tone="muted" size="xs" motion="none" /> Idle</span>
      </div>
    </section>

    <!-- Surfaces -->
    <section class="space-y-4">
      <h2 class="font-pixel text-xl">Panels and menus</h2>
      <div class="grid gap-4 md:grid-cols-2">
        <div class="border border-border bg-card">
          <PanelHeader title="Terminal">
            <Badge tone="success">running</Badge>
            {#snippet actions()}
              <Button size="icon-2xs" variant="quiet" aria-label="Restart"><RefreshIcon /></Button>
              <Button size="icon-2xs" variant="quiet" aria-label="Close"><XIcon /></Button>
            {/snippet}
          </PanelHeader>
          <pre class="p-3 text-caption text-muted-foreground">$ npm test{'\n'}✓ 135 test files passed</pre>
        </div>
        <div class="{menuPanel()} w-64">
          <div class={menuLabel}>Model</div>
          <button type="button" class={menuItem({ selected: true })}>Opus 5.5</button>
          <button type="button" class={menuItem()}>Sonnet 4.6</button>
          <button type="button" class={menuItem()}>Haiku 4.5</button>
          <div class={menuSeparator}></div>
          <button type="button" class={menuItem({ tone: 'destructive' })}>Close thread</button>
        </div>
      </div>
      <div class="pixel-bg flex h-32 items-center justify-center border border-border">
        <div class="text-center">
          <p class="font-pixel text-lg text-foreground/90">Nothing growing yet</p>
          <p class="text-xs text-muted-foreground">Empty states sit on the faint pixel texture (.pixel-bg).</p>
        </div>
      </div>
    </section>
  </div>
</div>
