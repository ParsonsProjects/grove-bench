<script>
  import { onMount } from 'svelte';
  import { initLandingAnalytics, trackLandingEvent } from './lib/analytics.js';
  import ConsentBanner from './ConsentBanner.svelte';

  let showConsentBanner = $state(false);

  onMount(() => {
    const consent = initLandingAnalytics();
    if (consent === 'pending') {
      showConsentBanner = true;
    }
  });

  // Intersection observer for scroll-triggered animations
  let visible = $state({});

  function observe(node, id) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          visible[id] = true;
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  // Pixel tree SVG data (from app TitleBar)
  const treeGreens = [
    { x: 9, y: 0, fill: '#6ec87a' },
    { x: 6, y: 3, fill: '#5ab868' },
    { x: 9, y: 3, fill: '#5ab868' },
    { x: 12, y: 3, fill: '#5ab868' },
    { x: 3, y: 6, fill: '#4aaa58' },
    { x: 6, y: 6, fill: '#4aaa58' },
    { x: 9, y: 6, fill: '#4aaa58' },
    { x: 12, y: 6, fill: '#4aaa58' },
    { x: 15, y: 6, fill: '#4aaa58' },
    { x: 0, y: 9, fill: '#3a9a48' },
    { x: 3, y: 9, fill: '#3a9a48' },
    { x: 6, y: 9, fill: '#3a9a48' },
    { x: 9, y: 9, fill: '#3a9a48' },
    { x: 12, y: 9, fill: '#3a9a48' },
    { x: 15, y: 9, fill: '#3a9a48' },
    { x: 18, y: 9, fill: '#3a9a48' },
    { x: 3, y: 12, fill: '#3a9a48' },
    { x: 6, y: 12, fill: '#3a9a48' },
    { x: 9, y: 12, fill: '#3a9a48' },
    { x: 12, y: 12, fill: '#3a9a48' },
    { x: 15, y: 12, fill: '#3a9a48' },
    { x: 9, y: 15, fill: '#8a6a4a' },
    { x: 9, y: 18, fill: '#8a6a4a' },
    { x: 6, y: 21, fill: '#6a5040' },
    { x: 9, y: 21, fill: '#6a5040' },
    { x: 12, y: 21, fill: '#6a5040' },
  ];

  const featureSections = [
    {
      id: 'parallel-agents',
      label: 'Parallel Agents',
      title: 'Run multiple agents simultaneously',
      description: 'Spawn unlimited Claude Code agents on the same repo. Each gets an isolated git worktree and dedicated PTY terminal. No branch conflicts, no lock contention — just parallel progress.',
      bullets: ['Isolated git worktrees per agent', 'Dedicated PTY terminals with full color', 'Independent branches that merge when ready'],
    },
    {
      id: 'terminals',
      label: 'Dedicated Terminals',
      title: 'Real interactive terminals per session',
      description: 'Each agent gets a dedicated PTY terminal with full color output, environment persistence, and shell state that survives restarts. Run tests, start servers, inspect output — all in context.',
      bullets: ['Persistent PTY per session (node-pty + xterm.js)', 'Full color output and environment persistence', 'Shell state survives app restarts'],
    },
    {
      id: 'project-memory',
      label: 'Project Memory',
      title: 'Context that persists across sessions',
      description: 'Organized markdown notes injected into agent system prompts automatically. Architecture decisions, coding conventions, and session context — always available, never forgotten.',
      bullets: ['Folder-based organization with frontmatter', 'Auto-injected into agent system prompts', 'Auto-save on session end and compaction'],
    },
    {
      id: 'checkpoints',
      label: 'Checkpoints & Rewind',
      title: 'Rewind to any point in time',
      description: 'Every agent turn creates a git checkpoint. Browse the timeline, view diffs at each step, and rewind to any previous state — files and conversation restored instantly.',
      bullets: ['Git-based snapshots at every turn', 'View file diffs between checkpoints', 'One-click rewind with full file restoration'],
    },
    {
      id: 'changes',
      label: 'Changes & Diffs',
      title: 'Review every file change',
      description: 'Dedicated changes panel with unified and side-by-side diff views. See staged and unstaged files, revert individual changes, or open files in your editor.',
      bullets: ['Unified and side-by-side diff views', 'Revert individual files', 'Open in editor with line numbers'],
    },
    {
      id: 'control',
      label: 'Permissions & Plugins',
      title: 'Full control over your agents',
      description: 'Interactive permission prompts with allow/deny rules and glob patterns. Extend functionality with a built-in plugin marketplace. Dev server auto-detection and management included.',
      bullets: ['Default, Plan, and AcceptEdits permission modes', 'Plugin marketplace with search and versioning', 'Dev server auto-detect from package.json'],
    },
  ];

  // Interactive mockup state
  let activeSession = $state('feat/auth');
  let activeTab = $state('activity');

  const sessions = [
    { id: 'feat/auth', branch: 'feat/auth', status: 'running' },
    { id: 'feat/api', branch: 'feat/api', status: 'running' },
    { id: 'fix/login-bug', branch: 'fix/login-bug', status: 'idle' },
  ];

  const sessionContent = {
    'feat/auth': {
      messages: [
        { type: 'user', text: 'Add JWT authentication middleware to all API routes' },
        { type: 'assistant', text: "I'll create the auth middleware and apply it to the protected routes. Let me start by examining the existing route structure." },
        { type: 'tool', name: 'Read', file: 'src/routes/index.ts' },
        { type: 'tool', name: 'Edit', file: 'src/middleware/auth.ts', added: 47, removed: 0 },
        { type: 'tool', name: 'Edit', file: 'src/routes/index.ts', added: 8, removed: 3 },
        { type: 'assistant', text: "I've created the JWT middleware and applied it to all protected routes. Running tests now..." },
        { type: 'tool', name: 'Bash', cmd: 'npm test' },
      ],
      model: 'Opus 4.6',
      tokens: '12.4k / 200k',
      tokenPct: 6,
    },
    'feat/api': {
      messages: [
        { type: 'user', text: 'Build a REST API for the user profile endpoints' },
        { type: 'assistant', text: "I'll scaffold the user profile CRUD endpoints with proper validation and error handling." },
        { type: 'tool', name: 'Write', file: 'src/routes/profile.ts', added: 89, removed: 0 },
        { type: 'tool', name: 'Write', file: 'src/types/profile.ts', added: 24, removed: 0 },
        { type: 'tool', name: 'Edit', file: 'src/routes/index.ts', added: 3, removed: 1 },
      ],
      model: 'Sonnet 4.6',
      tokens: '8.2k / 200k',
      tokenPct: 4,
    },
    'fix/login-bug': {
      messages: [
        { type: 'user', text: 'Fix the session timeout bug where users get logged out after 5 minutes' },
        { type: 'assistant', text: "Found the issue — the token refresh interval was set to 300s but the expiry is also 300s. I'll add a buffer and implement proper refresh logic." },
        { type: 'tool', name: 'Edit', file: 'src/auth/session.ts', added: 12, removed: 4 },
        { type: 'result', text: 'Session timeout fix applied. Token refreshes 30s before expiry.' },
      ],
      model: 'Opus 4.6',
      tokens: '5.1k / 200k',
      tokenPct: 3,
    },
  };

  $effect(() => {
    // Reset tab when switching sessions
    if (activeSession) activeTab = 'activity';
  });
</script>

<div class="min-h-screen bg-background text-foreground">

  <!-- Nav -->
  <nav class="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-md">
    <div class="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
      <a href="#" class="flex items-center gap-2.5 group" aria-label="Grove Bench home">
        <svg width="16" height="19" viewBox="0 0 21 24" fill="none" role="img" aria-label="Grove Bench pixel tree logo">
          {#each treeGreens as p}
            <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
          {/each}
        </svg>
        <span class="text-sm font-semibold tracking-tight">Grove Bench</span>
      </a>
      <div class="flex items-center gap-8">
        <a href="#features" class="text-xs text-muted-foreground hover:text-foreground transition-colors hidden md:block">Features</a>
        <a
          href="https://github.com/ParsonsProjects/grove-bench"
          target="_blank"
          rel="noopener"
          class="text-xs bg-primary text-primary-foreground px-4 py-2 font-medium hover:brightness-110 transition-all inline-flex items-center gap-2"
          onclick={() => trackLandingEvent('github_click', { location: 'nav' })}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
          GitHub
        </a>
      </div>
    </div>
  </nav>

  <!-- Hero -->
  <section class="hero-glow relative overflow-hidden">
    <!-- Animated blue pixels -->
    {#each Array(40) as _, i}
      <span
        class="blue-pixel absolute"
        style="width:4px;height:4px;top:{Math.round((5+(((i*37+13)*7)%90))/100*700/6)*6}px;left:{Math.round((2+(((i*53+7)*11)%96))/100*1400/6)*6}px;animation-delay:{(i*1.3)%8}s;"
      ></span>
    {/each}

    <div class="max-w-5xl mx-auto px-6 pt-24 pb-32 md:pt-36 md:pb-44 relative z-10">
      <div class="flex flex-col items-center text-center">
        <!-- Pixel grove — center tree largest, flanking trees smaller -->
        <div class="animate-fade-in-up mb-10 tree-glow flex items-end gap-1">
          <!-- Far left tree (smallest) -->
          <svg width="24" height="28" viewBox="0 0 21 24" fill="none" style="image-rendering: pixelated; opacity: 0.4;">
            {#each treeGreens as p}
              <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
            {/each}
          </svg>
          <!-- Left tree -->
          <svg width="40" height="46" viewBox="0 0 21 24" fill="none" style="image-rendering: pixelated; opacity: 0.6;">
            {#each treeGreens as p}
              <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
            {/each}
          </svg>
          <!-- Left-center tree -->
          <svg width="56" height="64" viewBox="0 0 21 24" fill="none" style="image-rendering: pixelated; opacity: 0.8;">
            {#each treeGreens as p}
              <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
            {/each}
          </svg>
          <!-- Center tree (largest) -->
          <svg width="84" height="96" viewBox="0 0 21 24" fill="none" style="image-rendering: pixelated;">
            {#each treeGreens as p}
              <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
            {/each}
          </svg>
          <!-- Right-center tree -->
          <svg width="56" height="64" viewBox="0 0 21 24" fill="none" style="image-rendering: pixelated; opacity: 0.8;">
            {#each treeGreens as p}
              <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
            {/each}
          </svg>
          <!-- Right tree -->
          <svg width="40" height="46" viewBox="0 0 21 24" fill="none" style="image-rendering: pixelated; opacity: 0.6;">
            {#each treeGreens as p}
              <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
            {/each}
          </svg>
          <!-- Far right tree (smallest) -->
          <svg width="24" height="28" viewBox="0 0 21 24" fill="none" style="image-rendering: pixelated; opacity: 0.4;">
            {#each treeGreens as p}
              <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
            {/each}
          </svg>
        </div>

        <!-- Gradient headline inspired by Linear -->
        <h1 class="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight animate-fade-in-up delay-1 hero-title leading-none">
          Parallel AI agents.<br/>
          <span class="text-gradient">Zero conflicts.</span>
        </h1>

        <p class="mt-6 md:mt-8 text-sm md:text-base text-muted-foreground max-w-md animate-fade-in-up delay-2 leading-relaxed">
          Multi-agent git worktree orchestrator for Claude Code.
          Every agent gets its own branch, terminal, and workspace.
        </p>

        <div class="mt-10 flex flex-wrap justify-center gap-3 animate-fade-in-up delay-3">
          <a
            href="https://github.com/ParsonsProjects/grove-bench/releases"
            target="_blank"
            rel="noopener"
            class="btn-primary"
            onclick={() => trackLandingEvent('download_click', { location: 'hero' })}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="image-rendering: pixelated;">
              <rect x="7" y="1" width="2" height="8"/>
              <rect x="5" y="7" width="2" height="2"/>
              <rect x="9" y="7" width="2" height="2"/>
              <rect x="3" y="9" width="2" height="2"/>
              <rect x="11" y="9" width="2" height="2"/>
              <rect x="1" y="13" width="14" height="2"/>
            </svg>
            Download for Windows
          </a>
          <a
            href="https://github.com/ParsonsProjects/grove-bench"
            target="_blank"
            rel="noopener"
            class="btn-secondary"
            onclick={() => trackLandingEvent('github_click', { location: 'hero' })}
          >
            View Source
          </a>
        </div>

        <!-- Interactive app mockup -->
        <div class="mt-20 w-full max-w-5xl animate-fade-in-up delay-4">
          <div class="app-mockup bg-card border border-border shadow-2xl shadow-primary/5">
            <!-- Title bar (32px) -->
            <div class="flex items-center h-8 px-3 border-b border-border bg-card select-none">
              <svg width="11" height="13" viewBox="0 0 21 24" fill="none" class="mr-2">
                {#each treeGreens as p}
                  <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
                {/each}
              </svg>
              <span class="text-[10px] text-muted-foreground">Grove Bench</span>
              <div class="ml-auto flex gap-1.5">
                <span class="w-6 h-5 flex items-center justify-center hover:bg-muted cursor-pointer">
                  <svg width="10" height="1" fill="currentColor" class="text-muted-foreground"><rect width="10" height="1"/></svg>
                </span>
                <span class="w-6 h-5 flex items-center justify-center hover:bg-muted cursor-pointer">
                  <svg width="8" height="8" fill="none" stroke="currentColor" class="text-muted-foreground" stroke-width="1"><rect x="0.5" y="0.5" width="7" height="7"/></svg>
                </span>
                <span class="w-6 h-5 flex items-center justify-center hover:bg-red-500/80 hover:text-white cursor-pointer">
                  <svg width="8" height="8" fill="none" stroke="currentColor" class="text-muted-foreground" stroke-width="1.2"><line x1="1" y1="1" x2="7" y2="7"/><line x1="7" y1="1" x2="1" y2="7"/></svg>
                </span>
              </div>
            </div>

            <div class="flex" style="height: 480px;">
              <!-- Sidebar (240px) -->
              <div class="w-[180px] md:w-[200px] border-r border-border bg-sidebar flex flex-col shrink-0 hidden md:flex">
                <div class="flex-1 overflow-hidden p-2.5">
                  <!-- Repos header -->
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-[9px] text-muted-foreground uppercase tracking-wider">Repositories</span>
                    <span class="text-[9px] text-muted-foreground/60">2/3 running</span>
                  </div>

                  <!-- Repo -->
                  <div class="mb-1">
                    <div class="flex items-center justify-between px-1.5 py-1 text-[10px] font-medium text-foreground/80 group">
                      <span class="text-muted-foreground/60">my-project</span>
                      <div class="flex items-center gap-0.5">
                        <span class="w-3.5 h-3.5 flex items-center justify-center text-muted-foreground/40 hover:text-primary cursor-pointer">
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- Sessions -->
                  <div class="space-y-0.5">
                    {#each sessions as session}
                      <button
                        class="w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors cursor-pointer {activeSession === session.id ? 'bg-accent' : 'hover:bg-accent/50'}"
                        onclick={() => { activeSession = session.id; activeTab = 'activity'; }}
                      >
                        <span class="w-1.5 h-1.5 shrink-0 {session.status === 'running' ? 'bg-primary animate-pulse' : 'bg-green-500'}"></span>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" class="shrink-0 text-muted-foreground/50"><path d="M4 2h4v2H4zm0 6h4v2H4zM2 4h2v4H2zm6 0h2v4H8zm8 0h4v2h-4zm0 6h4v2h-4zm-2-4h2v4h-2zm6 0h2v4h-2zm-8 13h5v2h-5zm5-5h2v5h-2zM5 12h2v10H5z"/></svg>
                        <span class="text-[10px] truncate {activeSession === session.id ? 'text-foreground' : 'text-muted-foreground'}">{session.branch}</span>
                      </button>
                    {/each}
                  </div>
                </div>

                <!-- Sidebar bottom controls -->
                <div class="border-t border-border p-2 space-y-1.5">
                  <!-- Add Repo button -->
                  <div class="flex items-center justify-center gap-1.5 px-2 py-1 text-[9px] text-muted-foreground border border-border/50 cursor-pointer hover:bg-accent/30 transition-colors">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                    Add Repo
                  </div>
                  <!-- Agent + Memory + Settings row -->
                  <div class="flex gap-1">
                    <div class="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[9px] text-foreground bg-primary/10 border border-primary/20 cursor-pointer">
                      + Agent
                    </div>
                    <div class="w-6 h-6 flex items-center justify-center text-muted-foreground/60 hover:text-foreground cursor-pointer" title="Project Memory">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c-1.5 0-3 .8-4 2s-1.5 3-2.5 3.5C4 8.5 3 10 3 12c0 1.5.5 3 1.5 4s1 2.5.5 3.5c.5 1.5 2 2.5 3.5 2.5H12"/><path d="M12 2c1.5 0 3 .8 4 2s1.5 2.5 2.5 3c1.5 1 2 2.5 2 4"/><path d="M12 2v20"/><path d="M12 8h5"/><path d="M12 14h4"/><circle cx="17.5" cy="8" r="1.2" fill="currentColor"/><circle cx="16.5" cy="14" r="1.2" fill="currentColor"/></svg>
                    </div>
                    <div class="w-6 h-6 flex items-center justify-center text-muted-foreground/60 hover:text-foreground cursor-pointer" title="Settings">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Main content area -->
              <div class="flex-1 flex flex-col min-w-0">
                <!-- Session tab bar -->
                <div class="flex items-center bg-card border-b border-border shrink-0 overflow-x-auto">
                  {#each sessions.filter(s => s.status !== 'idle' || s.id === activeSession) as session}
                    <button
                      class="flex items-center gap-1.5 px-3 py-1.5 text-[10px] border-r border-border shrink-0 transition-colors cursor-pointer
                        {activeSession === session.id ? 'bg-background text-foreground/80 border-b-2 border-b-primary' : 'bg-card text-muted-foreground hover:text-foreground border-b-2 border-b-transparent'}"
                      onclick={() => { activeSession = session.id; activeTab = 'activity'; }}
                    >
                      <span class="w-1.5 h-1.5 shrink-0 {session.status === 'running' ? 'bg-primary animate-pulse' : 'bg-green-500'}"></span>
                      {session.branch}
                    </button>
                  {/each}
                </div>

                <!-- Workspace tab bar -->
                <div class="flex items-center border-b border-border bg-card/50 shrink-0">
                  <button
                    class="flex items-center gap-1.5 px-3 py-1.5 text-[10px] transition-colors cursor-pointer
                      {activeTab === 'activity' ? 'text-foreground border-b border-b-primary' : 'text-muted-foreground hover:text-foreground border-b border-b-transparent'}"
                    onclick={() => activeTab = 'activity'}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M4 13h8v6h2v2h-2v2h-2v-8H2v-4h2v2Zm12 6h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2v-2h2v2Zm-6-6h8v4h-2v-2h-8V5h-2V3h2V1h2v8Zm-8 2H4V9h2v2Zm2-2H6V7h2v2Zm2-2H8V5h2v2Z"/></svg>
                    Activity
                    {#if sessions.find(s => s.id === activeSession)?.status === 'running'}
                      <span class="w-1 h-1 bg-primary animate-pulse"></span>
                    {/if}
                  </button>
                  <button
                    class="flex items-center gap-1.5 px-3 py-1.5 text-[10px] transition-colors cursor-pointer
                      {activeTab === 'changes' ? 'text-foreground border-b border-b-primary' : 'text-muted-foreground hover:text-foreground border-b border-b-transparent'}"
                    onclick={() => activeTab = 'changes'}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M16 19h2v2H4v-2h10v-2h2v2ZM6 15h8v2H4v2H2v-4h2V5h2v10ZM20 5h2v6h-2v8h-2V5H6V3h14v2Z"/></svg>
                    Changes
                    <span class="bg-primary text-white text-[8px] px-1 font-bold">3</span>
                  </button>
                  <button
                    class="flex items-center gap-1.5 px-3 py-1.5 text-[10px] transition-colors cursor-pointer
                      {activeTab === 'terminal' ? 'text-foreground border-b border-b-primary' : 'text-muted-foreground hover:text-foreground border-b border-b-transparent'}"
                    onclick={() => activeTab = 'terminal'}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,6 10,12 4,18"/><line x1="12" y1="18" x2="20" y2="18"/></svg>
                    Terminal
                  </button>
                </div>

                <!-- Content area -->
                <div class="flex-1 overflow-hidden text-left">
                  {#if activeTab === 'activity'}
                    <!-- Activity / message output -->
                    {@const content = sessionContent[activeSession]}
                    <div class="h-full overflow-y-auto p-3 space-y-2.5 text-[10px]">
                      {#each content.messages as msg}
                        {#if msg.type === 'user'}
                          <div class="bg-muted/30 px-3 py-2">
                            <span class="text-foreground">{msg.text}</span>
                          </div>
                        {:else if msg.type === 'assistant'}
                          <div class="px-3 py-1 text-muted-foreground leading-relaxed">{msg.text}</div>
                        {:else if msg.type === 'tool'}
                          <div class="flex items-center gap-2 px-3 py-1.5 border-l-2 border-l-primary/40">
                            <span class="text-amber-500/80">{msg.name}</span>
                            <span class="text-foreground/70">{msg.file || msg.cmd}</span>
                            {#if msg.added !== undefined}
                              <span class="text-green-500/70 ml-auto">+{msg.added}</span>
                              <span class="text-red-500/70">-{msg.removed}</span>
                            {/if}
                          </div>
                        {:else if msg.type === 'result'}
                          <div class="flex items-center gap-2 px-3 py-1.5 bg-green-500/5 border border-green-500/20">
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" class="text-green-500" stroke-width="1.5"><polyline points="2,6 5,9 10,3"/></svg>
                            <span class="text-green-500/80">{msg.text}</span>
                          </div>
                        {/if}
                      {/each}
                      {#if sessions.find(s => s.id === activeSession)?.status === 'running'}
                        <div class="flex items-center gap-2 px-3 py-1 text-primary/60">
                          <span class="w-1 h-1 bg-primary animate-pulse"></span>
                          Thinking...
                        </div>
                      {/if}
                    </div>
                  {:else if activeTab === 'changes'}
                    <!-- Changes / diff view -->
                    <div class="h-full overflow-y-auto p-3 space-y-1.5 text-[10px]">
                      <div class="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/20">
                        <span class="text-green-500 text-[9px] font-bold w-3">A</span>
                        <span class="text-foreground/80">src/middleware/auth.ts</span>
                        <span class="ml-auto text-green-500/70">+47</span>
                      </div>
                      <div class="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/20">
                        <span class="text-amber-500 text-[9px] font-bold w-3">M</span>
                        <span class="text-foreground/80">src/routes/index.ts</span>
                        <span class="ml-auto text-green-500/70">+8</span>
                        <span class="text-red-500/70">-3</span>
                      </div>
                      <div class="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/20">
                        <span class="text-amber-500 text-[9px] font-bold w-3">M</span>
                        <span class="text-foreground/80">package.json</span>
                        <span class="ml-auto text-green-500/70">+2</span>
                        <span class="text-red-500/70">-1</span>
                      </div>
                    </div>
                  {:else if activeTab === 'terminal'}
                    <!-- Terminal view -->
                    <div class="h-full p-3 text-[10px] text-left" style="background: #1f1f1f; color: #cccccc;">
                      <div class="space-y-1">
                        <div><span style="color: #6ec87a;">user@DESKTOP</span>:<span style="color: #5a9bcf;">~/my-project</span>$ npm test</div>
                        <div style="color: #888;">PASS src/middleware/auth.test.ts</div>
                        <div style="color: #888;">  ✓ validates JWT token (12ms)</div>
                        <div style="color: #888;">  ✓ rejects expired tokens (3ms)</div>
                        <div style="color: #888;">  ✓ handles missing auth header (2ms)</div>
                        <div class="mt-1" style="color: #6ec87a;">Tests: 3 passed, 3 total</div>
                        <div><span style="color: #6ec87a;">user@DESKTOP</span>:<span style="color: #5a9bcf;">~/my-project</span>$ <span class="animate-cursor-blink">_</span></div>
                      </div>
                    </div>
                  {/if}
                </div>

                <!-- Status bar -->
                <div class="flex items-center gap-3 px-3 py-1.5 text-[9px] border-t border-border bg-card/50 shrink-0 select-none">
                  <span class="text-muted-foreground">{activeSession}</span>
                  <span class="text-muted-foreground/40">|</span>
                  <span class="text-muted-foreground">{sessionContent[activeSession].model}</span>
                  <div class="ml-auto flex items-center gap-2">
                    <!-- Token bar -->
                    <div class="flex items-center gap-1.5">
                      <div class="w-16 h-1.5 bg-muted overflow-hidden">
                        <div class="h-full bg-green-500/60" style="width: {sessionContent[activeSession].tokenPct}%"></div>
                      </div>
                      <span class="text-muted-foreground/60">{sessionContent[activeSession].tokens}</span>
                    </div>
                    <span class="text-muted-foreground/40">|</span>
                    <span class="text-muted-foreground">default</span>
                  </div>
                </div>

                <!-- Prompt editor -->
                <div class="border-t border-border bg-card/50 px-3 py-2 shrink-0">
                  <div class="flex items-center gap-2">
                    <div class="flex-1 text-[10px] text-muted-foreground/40 px-2 py-1.5 border border-border bg-background/50">
                      {#if sessions.find(s => s.id === activeSession)?.status === 'running'}
                        Agent is working...
                      {:else}
                        Ask the agent to do something...
                      {/if}
                    </div>
                    <button class="px-2 py-1.5 bg-primary text-primary-foreground text-[10px] font-medium shrink-0">Send</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Features -->
  <section id="features" class="border-b border-border">
    <div class="max-w-5xl mx-auto px-6 pt-28 md:pt-36 pb-8" use:observe={'features'}>
      <div class="text-center mb-20 {visible['features'] ? 'animate-fade-in-up' : 'opacity-0'}">
        <p class="text-xs text-primary font-medium uppercase tracking-wider mb-3">Features</p>
        <h2 class="text-2xl md:text-4xl font-bold tracking-tight">
          Built for parallel AI coding
        </h2>
        <p class="mt-4 text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          Everything you need to run multiple Claude Code agents on one repository without the chaos.
        </p>
      </div>
    </div>

    <!-- Feature 1: Parallel Agents (mockup right) -->
    <div class="border-t border-border" use:observe={'feat-0'}>
      <div class="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <div class="flex flex-col md:flex-row gap-12 md:gap-16 items-center {visible['feat-0'] ? 'animate-fade-in-up' : 'opacity-0'}">
          <div class="md:w-2/5 shrink-0">
            <p class="text-[10px] text-primary font-medium uppercase tracking-wider mb-3">01</p>
            <h3 class="text-lg md:text-2xl font-bold tracking-tight mb-4">Run multiple agents simultaneously</h3>
            <p class="text-xs text-muted-foreground leading-relaxed mb-5">Spawn unlimited Claude Code agents on the same repo. Each gets an isolated git worktree and dedicated PTY terminal. No branch conflicts, no lock contention.</p>
            <ul class="space-y-2">
              {#each featureSections[0].bullets as bullet}
                <li class="flex items-center gap-2 text-xs text-muted-foreground">
                  <span class="w-1 h-1 bg-primary shrink-0"></span>
                  {bullet}
                </li>
              {/each}
            </ul>
          </div>
          <div class="md:w-3/5 w-full">
            <div class="bg-card border border-border shadow-2xl shadow-primary/5">
              <div class="flex gap-2 p-3">
                <div class="flex-1 border border-border bg-background flex flex-col">
                  <div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-sidebar text-[9px]">
                    <span class="w-1.5 h-1.5 bg-primary animate-pulse"></span>
                    <span class="text-foreground/80">feat/auth</span>
                    <span class="ml-auto text-muted-foreground/50">Opus 4.6</span>
                  </div>
                  <div class="flex-1 p-2 space-y-1.5 text-[9px]">
                    <div class="text-muted-foreground/60">Adding JWT middleware...</div>
                    <div class="flex items-center gap-1 border-l-2 border-l-primary/40 pl-1.5">
                      <span class="text-amber-500/80">Edit</span>
                      <span class="text-foreground/60">auth.ts</span>
                      <span class="ml-auto text-green-500/70">+47</span>
                    </div>
                    <div class="flex items-center gap-1 border-l-2 border-l-primary/40 pl-1.5">
                      <span class="text-amber-500/80">Edit</span>
                      <span class="text-foreground/60">routes.ts</span>
                      <span class="ml-auto text-green-500/70">+8</span>
                    </div>
                    <div class="flex items-center gap-1 border-l-2 border-l-primary/40 pl-1.5">
                      <span class="text-amber-500/80">Bash</span>
                      <span class="text-foreground/60">npm test</span>
                    </div>
                    <div class="flex items-center gap-1 text-primary/60">
                      <span class="w-1 h-1 bg-primary animate-pulse"></span>
                      Thinking...
                    </div>
                  </div>
                  <div class="px-2 py-1 border-t border-border text-[8px] text-muted-foreground/50 flex items-center gap-1.5">
                    <div class="w-10 h-1 bg-muted overflow-hidden"><div class="h-full bg-green-500/60" style="width: 6%"></div></div>
                    12.4k / 200k
                  </div>
                </div>

                <div class="flex-1 border border-border bg-background flex flex-col">
                  <div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-sidebar text-[9px]">
                    <span class="w-1.5 h-1.5 bg-primary animate-pulse"></span>
                    <span class="text-foreground/80">feat/api</span>
                    <span class="ml-auto text-muted-foreground/50">Sonnet 4.6</span>
                  </div>
                  <div class="flex-1 p-2 space-y-1.5 text-[9px]">
                    <div class="text-muted-foreground/60">Building profile endpoints...</div>
                    <div class="flex items-center gap-1 border-l-2 border-l-primary/40 pl-1.5">
                      <span class="text-amber-500/80">Write</span>
                      <span class="text-foreground/60">profile.ts</span>
                      <span class="ml-auto text-green-500/70">+89</span>
                    </div>
                    <div class="flex items-center gap-1 border-l-2 border-l-primary/40 pl-1.5">
                      <span class="text-amber-500/80">Write</span>
                      <span class="text-foreground/60">types.ts</span>
                      <span class="ml-auto text-green-500/70">+24</span>
                    </div>
                    <div class="flex items-center gap-1 text-primary/60">
                      <span class="w-1 h-1 bg-primary animate-pulse"></span>
                      Thinking...
                    </div>
                  </div>
                  <div class="px-2 py-1 border-t border-border text-[8px] text-muted-foreground/50 flex items-center gap-1.5">
                    <div class="w-10 h-1 bg-muted overflow-hidden"><div class="h-full bg-green-500/60" style="width: 4%"></div></div>
                    8.2k / 200k
                  </div>
                </div>

                <div class="flex-1 border border-border bg-background flex-col hidden md:flex">
                  <div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-sidebar text-[9px]">
                    <span class="w-1.5 h-1.5 bg-green-500"></span>
                    <span class="text-foreground/80">fix/login-bug</span>
                    <span class="ml-auto text-muted-foreground/50">Opus 4.6</span>
                  </div>
                  <div class="flex-1 p-2 space-y-1.5 text-[9px]">
                    <div class="text-muted-foreground/60">Session timeout fix...</div>
                    <div class="flex items-center gap-1 border-l-2 border-l-primary/40 pl-1.5">
                      <span class="text-amber-500/80">Edit</span>
                      <span class="text-foreground/60">session.ts</span>
                      <span class="ml-auto text-green-500/70">+12</span>
                      <span class="text-red-500/70">-4</span>
                    </div>
                    <div class="flex items-center gap-2 bg-green-500/5 border border-green-500/20 px-1.5 py-1">
                      <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" class="text-green-500" stroke-width="1.5"><polyline points="2,6 5,9 10,3"/></svg>
                      <span class="text-green-500/80">Complete</span>
                    </div>
                  </div>
                  <div class="px-2 py-1 border-t border-border text-[8px] text-muted-foreground/50 flex items-center gap-1.5">
                    <div class="w-10 h-1 bg-muted overflow-hidden"><div class="h-full bg-green-500/60" style="width: 3%"></div></div>
                    5.1k / 200k
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Feature 2: Dedicated Terminals (mockup left) -->
    <div class="border-t border-border bg-sidebar/30" use:observe={'feat-1'}>
      <div class="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <div class="flex flex-col md:flex-row-reverse gap-12 md:gap-16 items-center {visible['feat-1'] ? 'animate-fade-in-up' : 'opacity-0'}">
          <div class="md:w-2/5 shrink-0">
            <p class="text-[10px] text-primary font-medium uppercase tracking-wider mb-3">02</p>
            <h3 class="text-lg md:text-2xl font-bold tracking-tight mb-4">Real interactive terminals per session</h3>
            <p class="text-xs text-muted-foreground leading-relaxed mb-5">Each agent gets a dedicated PTY terminal with full color output, environment persistence, and shell state that survives restarts. Run tests, start servers, inspect output — all in context.</p>
            <ul class="space-y-2">
              {#each featureSections[1].bullets as bullet}
                <li class="flex items-center gap-2 text-xs text-muted-foreground">
                  <span class="w-1 h-1 bg-primary shrink-0"></span>
                  {bullet}
                </li>
              {/each}
            </ul>
          </div>
          <div class="md:w-3/5 w-full">
            <div class="bg-card border border-border shadow-2xl shadow-primary/5">
              <div class="flex items-center h-7 px-3 border-b border-border bg-sidebar">
                <span class="text-[9px] text-muted-foreground">Terminal — feat/auth</span>
                <span class="ml-auto text-[8px] text-muted-foreground/40">PTY</span>
              </div>
              <div class="p-4 text-[10px]" style="height: 270px; background: #1a1a1a; color: #cccccc;">
                <div class="space-y-1">
                  <div><span style="color: #6ec87a;">user@DESKTOP</span>:<span style="color: #5a9bcf;">~/worktrees/a3f8b2</span>$ npm test</div>
                  <div style="color: #888;">&nbsp;</div>
                  <div style="color: #cccccc;"> PASS <span style="color: #888;">src/middleware/auth.test.ts</span></div>
                  <div style="color: #6ec87a;">  ✓ validates JWT token <span style="color: #888;">(12ms)</span></div>
                  <div style="color: #6ec87a;">  ✓ rejects expired tokens <span style="color: #888;">(3ms)</span></div>
                  <div style="color: #6ec87a;">  ✓ handles missing auth header <span style="color: #888;">(2ms)</span></div>
                  <div style="color: #6ec87a;">  ✓ refreshes token before expiry <span style="color: #888;">(5ms)</span></div>
                  <div style="color: #888;">&nbsp;</div>
                  <div>Tests:  <span style="color: #6ec87a;">4 passed</span>, 4 total</div>
                  <div>Time:   <span style="color: #888;">0.847s</span></div>
                  <div style="color: #888;">&nbsp;</div>
                  <div><span style="color: #6ec87a;">user@DESKTOP</span>:<span style="color: #5a9bcf;">~/worktrees/a3f8b2</span>$ <span class="animate-cursor-blink">_</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Feature 3: Project Memory (mockup right) -->
    <div class="border-t border-border" use:observe={'feat-2'}>
      <div class="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <div class="flex flex-col md:flex-row gap-12 md:gap-16 items-center {visible['feat-2'] ? 'animate-fade-in-up' : 'opacity-0'}">
          <div class="md:w-2/5 shrink-0">
            <p class="text-[10px] text-primary font-medium uppercase tracking-wider mb-3">03</p>
            <h3 class="text-lg md:text-2xl font-bold tracking-tight mb-4">Context that persists across sessions</h3>
            <p class="text-xs text-muted-foreground leading-relaxed mb-5">Organized markdown notes injected into agent system prompts automatically. Architecture decisions, coding conventions, and session context — always available, never forgotten.</p>
            <ul class="space-y-2">
              {#each featureSections[2].bullets as bullet}
                <li class="flex items-center gap-2 text-xs text-muted-foreground">
                  <span class="w-1 h-1 bg-primary shrink-0"></span>
                  {bullet}
                </li>
              {/each}
            </ul>
          </div>
          <div class="md:w-3/5 w-full">
            <div class="bg-card border border-border shadow-2xl shadow-primary/5">
              <div class="flex text-[9px]" style="height: 300px;">
                <div class="w-[140px] border-r border-border bg-sidebar p-2 space-y-1 shrink-0">
                  <div class="text-[8px] text-muted-foreground/50 uppercase tracking-wider mb-1.5">Memory</div>
                  <div class="space-y-0.5">
                    <div class="flex items-center gap-1.5 px-1.5 py-1 text-muted-foreground/60">
                      <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5l.5-.5h4l.5.5v1H14l.5.5v8l-.5.5H1.5l-.5-.5V3.5zm1 1V12h12V5H6l-.5-.5H2z"/></svg>
                      conventions/
                    </div>
                    <div class="flex items-center gap-1.5 px-1.5 py-1 bg-accent text-foreground">
                      <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5l.5-.5h4l.5.5v1H14l.5.5v8l-.5.5H1.5l-.5-.5V3.5zm1 1V12h12V5H6l-.5-.5H2z"/></svg>
                      architecture/
                    </div>
                    <div class="flex items-center gap-1.5 px-1.5 py-1 text-muted-foreground/60 pl-5">
                      <svg width="7" height="7" viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 1H13l.5.5v13l-.5.5H3.5L3 14.5v-13l.5-.5zM4 14h9V2H4v12z"/></svg>
                      overview.md
                    </div>
                    <div class="flex items-center gap-1.5 px-1.5 py-1 text-muted-foreground/60 pl-5">
                      <svg width="7" height="7" viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 1H13l.5.5v13l-.5.5H3.5L3 14.5v-13l.5-.5zM4 14h9V2H4v12z"/></svg>
                      ipc-patterns.md
                    </div>
                    <div class="flex items-center gap-1.5 px-1.5 py-1 text-muted-foreground/60">
                      <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5l.5-.5h4l.5.5v1H14l.5.5v8l-.5.5H1.5l-.5-.5V3.5zm1 1V12h12V5H6l-.5-.5H2z"/></svg>
                      sessions/
                    </div>
                  </div>
                </div>
                <div class="flex-1 p-3 overflow-hidden">
                  <div class="text-[8px] text-muted-foreground/40 mb-2">architecture / overview.md</div>
                  <div class="space-y-1.5 text-muted-foreground/80">
                    <div class="text-[8px] text-muted-foreground/30">---</div>
                    <div class="text-[8px] text-muted-foreground/30">title: Architecture Overview</div>
                    <div class="text-[8px] text-muted-foreground/30">updatedAt: 2026-03-31</div>
                    <div class="text-[8px] text-muted-foreground/30">---</div>
                    <div class="mt-2 text-foreground/70 font-semibold text-[10px]">Architecture Overview</div>
                    <div class="text-muted-foreground/60 leading-relaxed">Main process manages AgentSessions via node-pty. IPC bridge through contextBridge in preload.ts. Git operations use execa calling git CLI directly.</div>
                    <div class="mt-1.5 text-foreground/70 font-semibold text-[10px]">Key Patterns</div>
                    <div class="text-muted-foreground/60">- Adapter pattern for agent backends</div>
                    <div class="text-muted-foreground/60">- Zod validation at IPC boundary</div>
                    <div class="text-muted-foreground/60">- Svelte 5 runes for reactive state</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Feature 4: Checkpoints & Rewind (mockup left) -->
    <div class="border-t border-border bg-sidebar/30" use:observe={'feat-3'}>
      <div class="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <div class="flex flex-col md:flex-row-reverse gap-12 md:gap-16 items-center {visible['feat-3'] ? 'animate-fade-in-up' : 'opacity-0'}">
          <div class="md:w-2/5 shrink-0">
            <p class="text-[10px] text-primary font-medium uppercase tracking-wider mb-3">04</p>
            <h3 class="text-lg md:text-2xl font-bold tracking-tight mb-4">Rewind to any point in time</h3>
            <p class="text-xs text-muted-foreground leading-relaxed mb-5">Every agent turn creates a git checkpoint. Browse the timeline, view diffs at each step, and rewind to any previous state — files and conversation restored instantly.</p>
            <ul class="space-y-2">
              {#each featureSections[3].bullets as bullet}
                <li class="flex items-center gap-2 text-xs text-muted-foreground">
                  <span class="w-1 h-1 bg-primary shrink-0"></span>
                  {bullet}
                </li>
              {/each}
            </ul>
          </div>
          <div class="md:w-3/5 w-full">
            <div class="bg-card border border-border shadow-2xl shadow-primary/5">
              <div class="flex text-[9px]" style="height: 300px;">
                <div class="w-[160px] border-r border-border p-2 space-y-0.5 shrink-0 overflow-hidden">
                  <div class="text-[8px] text-muted-foreground/50 uppercase tracking-wider mb-1.5">Checkpoints</div>
                  <div class="flex items-center gap-2 px-2 py-1.5 hover:bg-accent/30">
                    <div class="w-2 h-2 border border-muted-foreground/30 shrink-0"></div>
                    <div class="min-w-0">
                      <div class="text-foreground/70 truncate">Turn 5 · npm test</div>
                      <div class="text-[8px] text-muted-foreground/40">2 min ago</div>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 px-2 py-1.5 bg-accent">
                    <div class="w-2 h-2 bg-primary shrink-0"></div>
                    <div class="min-w-0">
                      <div class="text-foreground truncate">Turn 4 · Edit auth.ts</div>
                      <div class="text-[8px] text-muted-foreground/40">3 min ago</div>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 px-2 py-1.5 hover:bg-accent/30">
                    <div class="w-2 h-2 border border-muted-foreground/30 shrink-0"></div>
                    <div class="min-w-0">
                      <div class="text-foreground/70 truncate">Turn 3 · Read routes</div>
                      <div class="text-[8px] text-muted-foreground/40">4 min ago</div>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 px-2 py-1.5 hover:bg-accent/30">
                    <div class="w-2 h-2 border border-muted-foreground/30 shrink-0"></div>
                    <div class="min-w-0">
                      <div class="text-foreground/70 truncate">Turn 2 · Write mw</div>
                      <div class="text-[8px] text-muted-foreground/40">5 min ago</div>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 px-2 py-1.5 hover:bg-accent/30">
                    <div class="w-2 h-2 border border-muted-foreground/30 shrink-0"></div>
                    <div class="min-w-0">
                      <div class="text-foreground/70 truncate">Turn 1 · Initial</div>
                      <div class="text-[8px] text-muted-foreground/40">6 min ago</div>
                    </div>
                  </div>
                </div>
                <div class="flex-1 p-3 overflow-hidden">
                  <div class="flex items-center justify-between mb-3">
                    <div>
                      <div class="text-foreground/80 text-[10px] font-medium">Turn 4 · Edit auth.ts</div>
                      <div class="text-[8px] text-muted-foreground/40">3 minutes ago · 2 files changed</div>
                    </div>
                    <button class="px-2 py-1 bg-primary text-primary-foreground text-[9px] font-medium">Rewind here</button>
                  </div>
                  <div class="space-y-1">
                    <div class="text-[8px] text-muted-foreground/50 uppercase tracking-wider mb-1">Files changed</div>
                    <div class="flex items-center gap-2 px-2 py-1 hover:bg-muted/20">
                      <span class="text-amber-500 text-[8px] font-bold w-2.5">M</span>
                      <span class="text-foreground/70">src/middleware/auth.ts</span>
                      <span class="ml-auto text-green-500/70">+47</span>
                    </div>
                    <div class="flex items-center gap-2 px-2 py-1 hover:bg-muted/20">
                      <span class="text-amber-500 text-[8px] font-bold w-2.5">M</span>
                      <span class="text-foreground/70">src/routes/index.ts</span>
                      <span class="ml-auto text-green-500/70">+8</span>
                      <span class="text-red-500/70">-3</span>
                    </div>
                  </div>
                  <div class="mt-3 p-2 bg-background border border-border text-[8px] space-y-0.5">
                    <div class="text-muted-foreground/40">@@ -12,3 +12,8 @@ import &#123; Router &#125;</div>
                    <div class="text-green-500/70">+ import &#123; authMiddleware &#125; from './middleware/auth'</div>
                    <div class="text-muted-foreground/50">&nbsp; const router = new Router()</div>
                    <div class="text-green-500/70">+ router.use(authMiddleware)</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Feature 5: Changes & Diffs (mockup right) -->
    <div class="border-t border-border" use:observe={'feat-4'}>
      <div class="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <div class="flex flex-col md:flex-row gap-12 md:gap-16 items-center {visible['feat-4'] ? 'animate-fade-in-up' : 'opacity-0'}">
          <div class="md:w-2/5 shrink-0">
            <p class="text-[10px] text-primary font-medium uppercase tracking-wider mb-3">05</p>
            <h3 class="text-lg md:text-2xl font-bold tracking-tight mb-4">Review every file change</h3>
            <p class="text-xs text-muted-foreground leading-relaxed mb-5">Dedicated changes panel with unified and side-by-side diff views. See staged and unstaged files, revert individual changes, or open files in your editor.</p>
            <ul class="space-y-2">
              {#each featureSections[4].bullets as bullet}
                <li class="flex items-center gap-2 text-xs text-muted-foreground">
                  <span class="w-1 h-1 bg-primary shrink-0"></span>
                  {bullet}
                </li>
              {/each}
            </ul>
          </div>
          <div class="md:w-3/5 w-full">
            <div class="bg-card border border-border shadow-2xl shadow-primary/5">
              <div class="flex flex-col text-[9px]" style="height: 300px;">
                <div class="border-b border-border p-2 space-y-1">
                  <div class="flex items-center gap-2 px-2 py-1 bg-accent">
                    <span class="text-green-500 text-[8px] font-bold w-2.5">A</span>
                    <span class="text-foreground/80">src/middleware/auth.ts</span>
                    <span class="ml-auto text-green-500/70">+47</span>
                  </div>
                  <div class="flex items-center gap-2 px-2 py-1 hover:bg-accent/50">
                    <span class="text-amber-500 text-[8px] font-bold w-2.5">M</span>
                    <span class="text-foreground/70">src/routes/index.ts</span>
                    <span class="ml-auto text-green-500/70">+8</span>
                    <span class="text-red-500/70">-3</span>
                  </div>
                  <div class="flex items-center gap-2 px-2 py-1 hover:bg-accent/50">
                    <span class="text-amber-500 text-[8px] font-bold w-2.5">M</span>
                    <span class="text-foreground/70">package.json</span>
                    <span class="ml-auto text-green-500/70">+2</span>
                    <span class="text-red-500/70">-1</span>
                  </div>
                </div>
                <div class="flex-1 overflow-hidden p-2">
                  <div class="flex items-center justify-between px-2 py-1 mb-1.5">
                    <span class="text-foreground/70 text-[10px] font-medium">src/middleware/auth.ts</span>
                    <div class="flex gap-1">
                      <span class="px-1.5 py-0.5 bg-muted text-muted-foreground text-[8px]">Unified</span>
                      <span class="px-1.5 py-0.5 text-muted-foreground/40 text-[8px]">Side-by-side</span>
                    </div>
                  </div>
                  <div class="bg-background border border-border text-[8px] space-y-0 overflow-hidden">
                    <div class="flex">
                      <span class="w-8 text-right pr-1.5 text-muted-foreground/30 shrink-0 bg-green-500/5">1</span>
                      <span class="flex-1 px-1.5 bg-green-500/5 text-green-500/80">+ import &#123; verify &#125; from 'jsonwebtoken'</span>
                    </div>
                    <div class="flex">
                      <span class="w-8 text-right pr-1.5 text-muted-foreground/30 shrink-0 bg-green-500/5">2</span>
                      <span class="flex-1 px-1.5 bg-green-500/5 text-green-500/80">+ import &#123; Request, Response &#125; from 'express'</span>
                    </div>
                    <div class="flex">
                      <span class="w-8 text-right pr-1.5 text-muted-foreground/30 shrink-0">3</span>
                      <span class="flex-1 px-1.5 text-muted-foreground/60">&nbsp;</span>
                    </div>
                    <div class="flex">
                      <span class="w-8 text-right pr-1.5 text-muted-foreground/30 shrink-0 bg-green-500/5">4</span>
                      <span class="flex-1 px-1.5 bg-green-500/5 text-green-500/80">+ export function authMiddleware(req, res, next) &#123;</span>
                    </div>
                    <div class="flex">
                      <span class="w-8 text-right pr-1.5 text-muted-foreground/30 shrink-0 bg-green-500/5">5</span>
                      <span class="flex-1 px-1.5 bg-green-500/5 text-green-500/80">+   const token = req.headers.authorization?.split(' ')[1]</span>
                    </div>
                    <div class="flex">
                      <span class="w-8 text-right pr-1.5 text-muted-foreground/30 shrink-0 bg-green-500/5">6</span>
                      <span class="flex-1 px-1.5 bg-green-500/5 text-green-500/80">+   if (!token) return res.status(401).json(&#123; error: 'No token' &#125;)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Feature 6: Control (permissions + plugins + dev server) (mockup left) -->
    <div class="border-t border-border bg-sidebar/30" use:observe={'feat-5'}>
      <div class="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <div class="flex flex-col md:flex-row-reverse gap-12 md:gap-16 items-center {visible['feat-5'] ? 'animate-fade-in-up' : 'opacity-0'}">
          <div class="md:w-2/5 shrink-0">
            <p class="text-[10px] text-primary font-medium uppercase tracking-wider mb-3">06</p>
            <h3 class="text-lg md:text-2xl font-bold tracking-tight mb-4">Full control over your agents</h3>
            <p class="text-xs text-muted-foreground leading-relaxed mb-5">Interactive permission prompts with allow/deny rules and glob patterns. Extend functionality with a built-in plugin marketplace. Dev server auto-detection and management included.</p>
            <ul class="space-y-2">
              {#each featureSections[5].bullets as bullet}
                <li class="flex items-center gap-2 text-xs text-muted-foreground">
                  <span class="w-1 h-1 bg-primary shrink-0"></span>
                  {bullet}
                </li>
              {/each}
            </ul>
          </div>
          <div class="md:w-3/5 w-full">
            <div class="bg-card border border-border shadow-2xl shadow-primary/5">
              <div class="flex flex-col p-3 text-[9px] space-y-2.5" style="height: 300px;">
                <!-- Pending permission -->
                <div class="border-l-4 border-l-amber-500 bg-amber-500/5 border border-amber-500/20 p-2.5">
                  <div class="flex items-center gap-2 mb-2">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" class="text-amber-500" stroke-width="1.5"><path d="M8 1L1 14h14L8 1z"/><line x1="8" y1="6" x2="8" y2="9"/><circle cx="8" cy="11" r="0.5" fill="currentColor"/></svg>
                    <span class="text-amber-500 font-medium text-[10px]">Permission Required</span>
                  </div>
                  <div class="flex items-center gap-2 mb-2">
                    <span class="text-foreground/70">Edit</span>
                    <span class="text-muted-foreground/60">→</span>
                    <span class="text-foreground/80">src/middleware/auth.ts</span>
                  </div>
                  <div class="bg-background border border-border p-1.5 mb-2.5 text-[8px] space-y-0.5">
                    <div class="text-red-500/60">- const TOKEN_EXPIRY = 300</div>
                    <div class="text-green-500/70">+ const TOKEN_EXPIRY = 3600</div>
                    <div class="text-green-500/70">+ const REFRESH_BUFFER = 30</div>
                  </div>
                  <div class="flex gap-1.5">
                    <button class="px-2.5 py-1 bg-primary text-primary-foreground text-[8px] font-medium">Allow</button>
                    <button class="px-2.5 py-1 bg-muted text-muted-foreground text-[8px] border border-border">Deny</button>
                    <button class="px-2.5 py-1 text-muted-foreground/60 text-[8px]">Always allow Edit</button>
                  </div>
                </div>

                <!-- Resolved permission -->
                <div class="border-l-4 border-l-green-500 bg-green-500/5 border border-green-500/20 p-2.5">
                  <div class="flex items-center gap-2">
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" class="text-green-500" stroke-width="1.5"><polyline points="2,6 5,9 10,3"/></svg>
                    <span class="text-green-500/80 font-medium">Allowed</span>
                    <span class="text-foreground/60 ml-1">Bash</span>
                    <span class="text-muted-foreground/60">→</span>
                    <span class="text-foreground/70">npm test</span>
                  </div>
                </div>

                <!-- Mode selector -->
                <div class="mt-auto pt-2 border-t border-border flex items-center gap-3">
                  <span class="text-[8px] text-muted-foreground/50 uppercase tracking-wider">Mode</span>
                  <span class="px-2 py-0.5 bg-primary text-primary-foreground text-[8px] font-medium">Default</span>
                  <span class="px-2 py-0.5 bg-muted text-muted-foreground/60 text-[8px]">Plan</span>
                  <span class="px-2 py-0.5 bg-muted text-muted-foreground/60 text-[8px]">AcceptEdits</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Tech Stack -->
  <section class="border-b border-border">
    <div class="max-w-5xl mx-auto px-6 py-14" use:observe={'tech'}>
      <p class="text-center text-[10px] text-muted-foreground uppercase tracking-wider mb-6 {visible['tech'] ? 'animate-fade-in-up' : 'opacity-0'}">Built with</p>
      <div class="flex flex-wrap justify-center gap-3 {visible['tech'] ? 'animate-fade-in-up delay-1' : 'opacity-0'}">
        {#each ['Electron', 'Svelte 5', 'TypeScript', 'xterm.js', 'node-pty', 'Tailwind CSS', 'Claude Code'] as tech}
          <span class="px-3 py-1.5 text-xs border border-border bg-card text-muted-foreground">{tech}</span>
        {/each}
      </div>
    </div>
  </section>

  <!-- CTA -->
  <section class="hero-glow relative overflow-hidden">
    {#each Array(25) as _, i}
      <span
        class="blue-pixel absolute"
        style="width:4px;height:4px;top:{Math.round((8+(((i*41+17)*7)%84))/100*400/6)*6}px;left:{Math.round((3+(((i*59+11)*11)%94))/100*1400/6)*6}px;animation-delay:{(i*1.7)%8}s;"
      ></span>
    {/each}

    <div class="max-w-5xl mx-auto px-6 py-28 md:py-36 text-center relative z-10" use:observe={'cta'}>
      <div class="{visible['cta'] ? 'animate-fade-in-up' : 'opacity-0'}">
        <div class="tree-glow inline-block mb-8">
          <svg width="48" height="56" viewBox="0 0 21 24" fill="none" style="image-rendering: pixelated;">
            {#each treeGreens as p}
              <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
            {/each}
          </svg>
        </div>
        <h2 class="text-2xl md:text-4xl font-bold tracking-tight mb-4">Start building in parallel</h2>
        <p class="text-sm text-muted-foreground mb-10 max-w-sm mx-auto leading-relaxed">
          Free, open source, and ready to use. Let your agents work together.
        </p>
        <div class="flex flex-wrap justify-center gap-3">
          <a
            href="https://github.com/ParsonsProjects/grove-bench/releases"
            target="_blank"
            rel="noopener"
            class="btn-primary"
            onclick={() => trackLandingEvent('download_click', { location: 'cta' })}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="image-rendering: pixelated;">
              <rect x="7" y="1" width="2" height="8"/>
              <rect x="5" y="7" width="2" height="2"/>
              <rect x="9" y="7" width="2" height="2"/>
              <rect x="3" y="9" width="2" height="2"/>
              <rect x="11" y="9" width="2" height="2"/>
              <rect x="1" y="13" width="14" height="2"/>
            </svg>
            Download for Windows
          </a>
          <a
            href="https://github.com/ParsonsProjects/grove-bench"
            target="_blank"
            rel="noopener"
            class="btn-secondary"
            onclick={() => trackLandingEvent('github_click', { location: 'cta' })}
          >
            Star on GitHub
          </a>
        </div>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="border-t border-border bg-card">
    <div class="max-w-5xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
      <div class="flex items-center gap-2.5">
        <svg width="11" height="13" viewBox="0 0 21 24" fill="none">
          {#each treeGreens as p}
            <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
          {/each}
        </svg>
        <span class="text-xs text-muted-foreground">Grove Bench</span>
        <span class="text-xs text-muted-foreground/40 ml-2">Open source under MIT</span>
      </div>
      <div class="flex items-center gap-6">
        <a
          href="https://github.com/ParsonsProjects/grove-bench"
          target="_blank"
          rel="noopener"
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          GitHub
        </a>
        <a
          href="https://github.com/ParsonsProjects/grove-bench/releases"
          target="_blank"
          rel="noopener"
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Releases
        </a>
        <a
          href="https://github.com/ParsonsProjects/grove-bench/blob/main/CONTRIBUTING.md"
          target="_blank"
          rel="noopener"
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Contributing
        </a>
        <a
          href="https://github.com/ParsonsProjects/grove-bench/blob/main/LICENSE"
          target="_blank"
          rel="noopener"
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          License
        </a>
        <a
          href="https://github.com/ParsonsProjects/grove-bench/issues"
          target="_blank"
          rel="noopener"
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Issues
        </a>
      </div>
    </div>
  </footer>
</div>

<ConsentBanner visible={showConsentBanner} ondismiss={() => showConsentBanner = false} />
