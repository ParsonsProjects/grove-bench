<script>
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

  const features = [
    {
      title: 'Worktree Isolation',
      desc: 'Each agent gets its own git worktree. No branch conflicts, no stepping on each other\'s changes. Clean separation by default.',
      icon: 'worktree',
    },
    {
      title: 'Dedicated PTY Terminals',
      desc: 'Real interactive terminals per session. Full color output, environment persistence, and shell state that survives restarts.',
      icon: 'terminal',
    },
    {
      title: 'Parallel Agents',
      desc: 'Run multiple Claude Code agents simultaneously on the same repository. Each works independently, merges when ready.',
      icon: 'agents',
    },
    {
      title: 'Windows Native',
      desc: 'Built with Electron for Windows. Proper file locking, PATH_MAX safety, native Squirrel installer. No WSL required.',
      icon: 'windows',
    },
  ];

  const steps = [
    { num: '01', title: 'Add a Repository', desc: 'Point Grove Bench at any local git repo.' },
    { num: '02', title: 'Spawn Agents', desc: 'Each agent gets an isolated worktree and branch.' },
    { num: '03', title: 'Work in Parallel', desc: 'Review diffs, manage permissions, merge when ready.' },
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
      <a href="#" class="flex items-center gap-2.5 group">
        <svg width="16" height="19" viewBox="0 0 21 24" fill="none">
          {#each treeGreens as p}
            <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
          {/each}
        </svg>
        <span class="text-sm font-semibold tracking-tight">Grove Bench</span>
      </a>
      <div class="flex items-center gap-8">
        <a href="#features" class="text-xs text-muted-foreground hover:text-foreground transition-colors hidden md:block">Features</a>
        <a href="#how-it-works" class="text-xs text-muted-foreground hover:text-foreground transition-colors hidden md:block">How It Works</a>
        <a
          href="https://github.com/alanpjohn/grove-bench"
          target="_blank"
          rel="noopener"
          class="text-xs bg-primary text-primary-foreground px-4 py-2 font-medium hover:brightness-110 transition-all inline-flex items-center gap-2"
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
        <!-- Pixel tree with glow -->
        <div class="animate-fade-in-up mb-10 tree-glow">
          <svg width="84" height="96" viewBox="0 0 21 24" fill="none" style="image-rendering: pixelated;">
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
            href="https://github.com/alanpjohn/grove-bench/releases"
            target="_blank"
            rel="noopener"
            class="btn-primary"
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
            href="https://github.com/alanpjohn/grove-bench"
            target="_blank"
            rel="noopener"
            class="btn-secondary"
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
                <span class="w-6 h-5 flex items-center justify-center hover:bg-muted cursor-default">
                  <svg width="10" height="1" fill="currentColor" class="text-muted-foreground"><rect width="10" height="1"/></svg>
                </span>
                <span class="w-6 h-5 flex items-center justify-center hover:bg-muted cursor-default">
                  <svg width="8" height="8" fill="none" stroke="currentColor" class="text-muted-foreground" stroke-width="1"><rect x="0.5" y="0.5" width="7" height="7"/></svg>
                </span>
                <span class="w-6 h-5 flex items-center justify-center hover:bg-red-500/80 hover:text-white cursor-default">
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
                    <div class="flex items-center gap-1.5 px-1.5 py-1 text-[10px] font-medium text-foreground/80">
                      <span class="text-muted-foreground/60">my-project</span>
                    </div>
                  </div>

                  <!-- Sessions -->
                  <div class="space-y-0.5">
                    {#each sessions as session}
                      <button
                        class="w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors {activeSession === session.id ? 'bg-accent' : 'hover:bg-accent/50'}"
                        onclick={() => { activeSession = session.id; activeTab = 'activity'; }}
                      >
                        <span class="w-1.5 h-1.5 shrink-0 {session.status === 'running' ? 'bg-primary animate-pulse' : 'bg-green-500'}"></span>
                        <svg width="10" height="10" viewBox="0 0 14 14" fill="none" class="shrink-0 text-muted-foreground/50">
                          <rect x="1" y="1" width="5" height="5" stroke="currentColor" stroke-width="1"/>
                          <rect x="8" y="8" width="5" height="5" stroke="currentColor" stroke-width="1"/>
                          <line x1="6" y1="3.5" x2="10.5" y2="3.5" stroke="currentColor" stroke-width="1"/>
                          <line x1="10.5" y1="3.5" x2="10.5" y2="8" stroke="currentColor" stroke-width="1"/>
                        </svg>
                        <span class="text-[10px] truncate {activeSession === session.id ? 'text-foreground' : 'text-muted-foreground'}">{session.branch}</span>
                      </button>
                    {/each}
                  </div>
                </div>

                <!-- Sidebar bottom buttons -->
                <div class="border-t border-border p-2 space-y-1">
                  <div class="flex items-center gap-1.5 px-2 py-1 text-[10px] text-primary cursor-default">
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><rect x="5" y="1" width="2" height="10"/><rect x="1" y="5" width="10" height="2"/></svg>
                    <span>New Agent</span>
                  </div>
                </div>
              </div>

              <!-- Main content area -->
              <div class="flex-1 flex flex-col min-w-0">
                <!-- Session tab bar -->
                <div class="flex items-center bg-card border-b border-border shrink-0 overflow-x-auto">
                  {#each sessions.filter(s => s.status !== 'idle' || s.id === activeSession) as session}
                    <button
                      class="flex items-center gap-1.5 px-3 py-1.5 text-[10px] border-r border-border shrink-0 transition-colors
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
                    class="flex items-center gap-1.5 px-3 py-1.5 text-[10px] transition-colors
                      {activeTab === 'activity' ? 'text-foreground border-b border-b-primary' : 'text-muted-foreground hover:text-foreground border-b border-b-transparent'}"
                    onclick={() => activeTab = 'activity'}
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2"><polyline points="1,8 3,4 5,6 7,2 9,5 11,3"/></svg>
                    Activity
                    {#if sessions.find(s => s.id === activeSession)?.status === 'running'}
                      <span class="w-1 h-1 bg-primary animate-pulse"></span>
                    {/if}
                  </button>
                  <button
                    class="flex items-center gap-1.5 px-3 py-1.5 text-[10px] transition-colors
                      {activeTab === 'changes' ? 'text-foreground border-b border-b-primary' : 'text-muted-foreground hover:text-foreground border-b border-b-transparent'}"
                    onclick={() => activeTab = 'changes'}
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2,1 L2,11 M6,1 L6,11 M10,1 L10,11"/></svg>
                    Changes
                    <span class="bg-primary text-white text-[8px] px-1 font-bold">3</span>
                  </button>
                  <button
                    class="flex items-center gap-1.5 px-3 py-1.5 text-[10px] transition-colors
                      {activeTab === 'terminal' ? 'text-foreground border-b border-b-primary' : 'text-muted-foreground hover:text-foreground border-b border-b-transparent'}"
                    onclick={() => activeTab = 'terminal'}
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2"><polyline points="2,3 5,6 2,9"/><line x1="6" y1="9" x2="10" y2="9"/></svg>
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

  <!-- Value prop strip (like ngrok's social proof bar) -->
  <section class="border-y border-border bg-sidebar/50">
    <div class="max-w-5xl mx-auto px-6 py-8" use:observe={'values'}>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-0 md:divide-x md:divide-border text-center {visible['values'] ? 'animate-fade-in-up' : 'opacity-0'}">
        <div class="md:px-8">
          <div class="text-2xl font-bold text-primary">1:1</div>
          <div class="text-xs text-muted-foreground mt-1">agent to worktree isolation</div>
        </div>
        <div class="md:px-8">
          <div class="text-2xl font-bold text-foreground">0</div>
          <div class="text-xs text-muted-foreground mt-1">branch conflicts</div>
        </div>
        <div class="md:px-8">
          <div class="text-2xl font-bold text-green-500">100%</div>
          <div class="text-xs text-muted-foreground mt-1">open source</div>
        </div>
      </div>
    </div>
  </section>

  <!-- Features -->
  <section id="features" class="border-b border-border">
    <div class="max-w-5xl mx-auto px-6 py-28 md:py-36" use:observe={'features'}>
      <div class="text-center mb-16 {visible['features'] ? 'animate-fade-in-up' : 'opacity-0'}">
        <p class="text-xs text-primary font-medium uppercase tracking-wider mb-3">Features</p>
        <h2 class="text-2xl md:text-4xl font-bold tracking-tight">
          Built for parallel AI coding
        </h2>
        <p class="mt-4 text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          Everything you need to run multiple Claude Code agents on one repository without the chaos.
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        {#each features as feature, i}
          <div class="feature-card group {visible['features'] ? `animate-fade-in-up delay-${i + 1}` : 'opacity-0'}">
            <div class="flex items-start gap-4">
              <div class="shrink-0 w-10 h-10 bg-primary/10 flex items-center justify-center">
                {#if feature.icon === 'worktree'}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--color-primary)" style="image-rendering: pixelated;">
                    <rect x="4" y="2" width="4" height="2"/>
                    <rect x="4" y="8" width="4" height="2"/>
                    <rect x="2" y="4" width="2" height="4"/>
                    <rect x="8" y="4" width="2" height="4"/>
                    <rect x="16" y="4" width="4" height="2"/>
                    <rect x="16" y="10" width="4" height="2"/>
                    <rect x="14" y="6" width="2" height="4"/>
                    <rect x="20" y="6" width="2" height="4"/>
                    <rect x="10" y="17" width="5" height="2"/>
                    <rect x="12" y="12" width="2" height="5"/>
                    <rect x="5" y="12" width="2" height="10"/>
                  </svg>
                {:else if feature.icon === 'terminal'}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--color-primary)" style="image-rendering: pixelated;">
                    <rect x="2" y="4" width="20" height="2"/>
                    <rect x="2" y="18" width="20" height="2"/>
                    <rect x="2" y="4" width="2" height="16"/>
                    <rect x="20" y="4" width="2" height="16"/>
                    <rect x="6" y="10" width="2" height="2"/>
                    <rect x="8" y="12" width="2" height="2"/>
                    <rect x="10" y="14" width="2" height="2"/>
                    <rect x="12" y="14" width="4" height="2"/>
                  </svg>
                {:else if feature.icon === 'agents'}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--color-primary)" style="image-rendering: pixelated;">
                    <rect x="3" y="4" width="4" height="4"/>
                    <rect x="1" y="10" width="8" height="2"/>
                    <rect x="3" y="12" width="4" height="4"/>
                    <rect x="10" y="2" width="4" height="4"/>
                    <rect x="8" y="8" width="8" height="2"/>
                    <rect x="10" y="10" width="4" height="4"/>
                    <rect x="17" y="4" width="4" height="4"/>
                    <rect x="15" y="10" width="8" height="2"/>
                    <rect x="17" y="12" width="4" height="4"/>
                  </svg>
                {:else if feature.icon === 'windows'}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--color-primary)" style="image-rendering: pixelated;">
                    <rect x="2" y="6" width="8" height="2"/>
                    <rect x="2" y="8" width="2" height="6"/>
                    <rect x="8" y="8" width="2" height="6"/>
                    <rect x="2" y="14" width="8" height="2"/>
                    <rect x="4" y="10" width="4" height="2"/>
                    <rect x="12" y="4" width="10" height="2"/>
                    <rect x="12" y="6" width="2" height="8"/>
                    <rect x="20" y="6" width="2" height="8"/>
                    <rect x="12" y="14" width="10" height="2"/>
                    <rect x="14" y="8" width="2" height="4"/>
                    <rect x="18" y="8" width="2" height="4"/>
                    <rect x="4" y="18" width="16" height="2"/>
                  </svg>
                {/if}
              </div>
              <div>
                <h3 class="text-sm font-semibold mb-2">{feature.title}</h3>
                <p class="text-xs text-muted-foreground leading-relaxed">{feature.desc}</p>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- How It Works -->
  <section id="how-it-works" class="border-b border-border bg-sidebar/30">
    <div class="max-w-5xl mx-auto px-6 py-28 md:py-36" use:observe={'steps'}>
      <div class="text-center mb-16 {visible['steps'] ? 'animate-fade-in-up' : 'opacity-0'}">
        <p class="text-xs text-primary font-medium uppercase tracking-wider mb-3">Workflow</p>
        <h2 class="text-2xl md:text-4xl font-bold tracking-tight">
          Three steps to parallel coding
        </h2>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
        {#each steps as step, i}
          <div class="text-center {visible['steps'] ? `animate-fade-in-up delay-${i + 1}` : 'opacity-0'}">
            <div class="flex justify-center mb-5">
              <span class="step-number">{step.num}</span>
            </div>
            <h3 class="text-sm font-semibold mb-2">{step.title}</h3>
            <p class="text-xs text-muted-foreground leading-relaxed max-w-[220px] mx-auto">{step.desc}</p>
          </div>
        {/each}
      </div>

      <!-- Code example (ngrok-inspired) -->
      <div class="mt-20 {visible['steps'] ? 'animate-fade-in-up delay-4' : 'opacity-0'}">
        <div class="bg-card border border-border max-w-xl mx-auto">
          <div class="flex items-center h-8 px-3 border-b border-border bg-sidebar">
            <span class="text-[10px] text-muted-foreground">Terminal</span>
          </div>
          <div class="p-5 text-xs space-y-2">
            <div class="flex gap-2">
              <span class="text-green-500 shrink-0">$</span>
              <span class="text-muted-foreground">grove-bench spawn --repo ./my-app --branch feat/auth</span>
            </div>
            <div class="text-muted-foreground/60 pl-5">Creating worktree at /worktrees/a3f8b2...</div>
            <div class="text-muted-foreground/60 pl-5">Spawning Claude Code agent...</div>
            <div class="text-green-500/80 pl-5">Agent 1 ready on feat/auth</div>
            <div class="mt-2 flex gap-2">
              <span class="text-green-500 shrink-0">$</span>
              <span class="text-muted-foreground">grove-bench spawn --repo ./my-app --branch feat/api</span>
            </div>
            <div class="text-green-500/80 pl-5">Agent 2 ready on feat/api</div>
            <div class="mt-2 flex gap-2">
              <span class="text-green-500 shrink-0">$</span>
              <span class="text-muted-foreground">grove-bench status</span>
            </div>
            <div class="text-primary pl-5">2 agents running, 0 conflicts</div>
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
            href="https://github.com/alanpjohn/grove-bench/releases"
            target="_blank"
            rel="noopener"
            class="btn-primary"
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
            href="https://github.com/alanpjohn/grove-bench"
            target="_blank"
            rel="noopener"
            class="btn-secondary"
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
          href="https://github.com/alanpjohn/grove-bench"
          target="_blank"
          rel="noopener"
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          GitHub
        </a>
        <a
          href="https://github.com/alanpjohn/grove-bench/releases"
          target="_blank"
          rel="noopener"
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Releases
        </a>
        <a
          href="https://github.com/alanpjohn/grove-bench/issues"
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
