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
      { threshold: 0.15 }
    );
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  // Pixel tree SVG (from app TitleBar — scaled up for hero)
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
      desc: 'Each agent gets its own git worktree — no branch conflicts, no stepping on each other\'s changes.',
      icon: 'worktree',
    },
    {
      title: 'Dedicated PTY Terminals',
      desc: 'Real interactive terminals per session with full color, env persistence, and shell state.',
      icon: 'terminal',
    },
    {
      title: 'Parallel Agents',
      desc: 'Run up to 3 AI coding agents simultaneously on the same repository.',
      icon: 'agents',
    },
    {
      title: 'Windows Native',
      desc: 'Built with Electron for Windows. Proper file locking, PATH_MAX safety, native installer.',
      icon: 'windows',
    },
  ];

  const steps = [
    { num: '01', title: 'Add Repository', desc: 'Point Grove Bench at any local git repository.' },
    { num: '02', title: 'Spawn Agents', desc: 'Create agent sessions — each gets an isolated worktree and branch.' },
    { num: '03', title: 'Work in Parallel', desc: 'Agents code simultaneously. Review diffs, manage permissions, merge when ready.' },
  ];
</script>

<div class="min-h-screen bg-background text-foreground">

  <!-- Nav -->
  <nav class="border-b border-border bg-card">
    <div class="max-w-6xl mx-auto px-6 h-12 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <svg width="16" height="19" viewBox="0 0 21 24" fill="none">
          {#each treeGreens as p}
            <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
          {/each}
        </svg>
        <span class="text-sm font-medium">Grove Bench</span>
      </div>
      <div class="flex items-center gap-6">
        <a href="#features" class="text-xs text-muted-foreground hover:text-foreground transition-colors">Features</a>
        <a href="#how-it-works" class="text-xs text-muted-foreground hover:text-foreground transition-colors">How It Works</a>
        <a
          href="https://github.com/alanpjohn/grove-bench"
          target="_blank"
          rel="noopener"
          class="text-xs bg-primary text-primary-foreground px-3 py-1.5 hover:brightness-110 transition-all"
        >
          GitHub
        </a>
      </div>
    </div>
  </nav>

  <!-- Hero -->
  <section class="pixel-bg relative overflow-hidden">
    <!-- Animated blue pixels -->
    {#each Array(30) as _, i}
      <span
        class="blue-pixel absolute"
        style="width:4px;height:4px;top:{Math.round((5+(((i*37+13)*7)%90))/100*600/6)*6}px;left:{Math.round((2+(((i*53+7)*11)%96))/100*1400/6)*6}px;animation-delay:{(i*1.3)%6}s;"
      ></span>
    {/each}

    <div class="max-w-6xl mx-auto px-6 py-28 md:py-36 relative z-10">
      <div class="flex flex-col items-center text-center">
        <!-- Large pixel tree -->
        <div class="animate-fade-in-up mb-8">
          <svg width="84" height="96" viewBox="0 0 21 24" fill="none" style="image-rendering: pixelated;">
            {#each treeGreens as p}
              <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
            {/each}
          </svg>
        </div>

        <h1 class="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight animate-fade-in-up delay-1">
          Grove Bench
        </h1>

        <p class="mt-5 text-sm md:text-base text-muted-foreground max-w-lg animate-fade-in-up delay-2 leading-relaxed">
          Multi-agent git worktree orchestrator for Claude Code.
          <br class="hidden md:block"/>
          Run parallel AI agents on the same repo, zero conflicts.
        </p>

        <div class="mt-10 flex flex-wrap justify-center gap-3 animate-fade-in-up delay-3">
          <a
            href="https://github.com/alanpjohn/grove-bench/releases"
            target="_blank"
            rel="noopener"
            class="bg-primary text-primary-foreground px-6 py-2.5 text-sm font-medium hover:brightness-110 transition-all inline-flex items-center gap-2"
          >
            <!-- Pixel download icon -->
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <rect x="7" y="1" width="2" height="8"/>
              <rect x="5" y="7" width="2" height="2"/>
              <rect x="9" y="7" width="2" height="2"/>
              <rect x="3" y="9" width="2" height="2"/>
              <rect x="11" y="9" width="2" height="2"/>
              <rect x="1" y="13" width="14" height="2"/>
            </svg>
            Download
          </a>
          <a
            href="https://github.com/alanpjohn/grove-bench"
            target="_blank"
            rel="noopener"
            class="bg-secondary text-secondary-foreground px-6 py-2.5 text-sm font-medium hover:brightness-110 transition-all"
          >
            View Source
          </a>
        </div>

        <!-- Terminal mockup -->
        <div class="mt-16 w-full max-w-2xl animate-fade-in-up delay-4">
          <div class="bg-card border border-border">
            <!-- Title bar -->
            <div class="flex items-center h-8 px-3 border-b border-border bg-sidebar">
              <svg width="11" height="13" viewBox="0 0 21 24" fill="none" class="mr-1.5">
                {#each treeGreens as p}
                  <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
                {/each}
              </svg>
              <span class="text-xs text-muted-foreground">Grove Bench</span>
              <div class="ml-auto flex gap-2">
                <span class="w-2.5 h-2.5 bg-muted"></span>
                <span class="w-2.5 h-2.5 bg-muted"></span>
                <span class="w-2.5 h-2.5 bg-muted"></span>
              </div>
            </div>
            <!-- Content area -->
            <div class="flex">
              <!-- Sidebar mockup -->
              <div class="w-48 border-r border-border bg-sidebar p-3 hidden md:block">
                <span class="text-[10px] text-muted-foreground uppercase tracking-wider">Repositories</span>
                <div class="mt-2.5 space-y-1">
                  <div class="flex items-center gap-2 px-2 py-1.5 bg-accent">
                    <span class="w-1.5 h-1.5 bg-green-500 shrink-0"></span>
                    <span class="text-[11px] truncate">my-project</span>
                  </div>
                </div>
                <div class="mt-4">
                  <span class="text-[10px] text-muted-foreground uppercase tracking-wider">Sessions</span>
                  <div class="mt-2 space-y-1">
                    <div class="flex items-center gap-2 px-2 py-1.5">
                      <span class="w-1.5 h-1.5 bg-primary shrink-0 animate-pulse"></span>
                      <span class="text-[11px] text-muted-foreground truncate">feat/auth</span>
                    </div>
                    <div class="flex items-center gap-2 px-2 py-1.5">
                      <span class="w-1.5 h-1.5 bg-primary shrink-0 animate-pulse"></span>
                      <span class="text-[11px] text-muted-foreground truncate">feat/api</span>
                    </div>
                    <div class="flex items-center gap-2 px-2 py-1.5">
                      <span class="w-1.5 h-1.5 bg-green-500 shrink-0"></span>
                      <span class="text-[11px] text-muted-foreground truncate">fix/login-bug</span>
                    </div>
                  </div>
                </div>
              </div>
              <!-- Main area -->
              <div class="flex-1 p-5 min-h-[200px]">
                <div class="space-y-3.5 text-xs">
                  <div class="flex gap-2">
                    <span class="text-primary shrink-0">{'>'}</span>
                    <span class="text-muted-foreground">Add authentication middleware to the API routes</span>
                  </div>
                  <div class="flex gap-2 text-muted-foreground">
                    <span class="text-green-500 shrink-0">{'$'}</span>
                    <span>I'll create the auth middleware and apply it to the protected routes.</span>
                  </div>
                  <div class="flex gap-2 items-start">
                    <span class="text-amber-500 shrink-0">{'~'}</span>
                    <div>
                      <span class="text-muted-foreground">Edit </span>
                      <span class="text-foreground">src/middleware/auth.ts</span>
                      <span class="text-green-500/70 ml-2">+42</span>
                      <span class="text-red-500/70 ml-1">-3</span>
                    </div>
                  </div>
                  <div class="flex gap-2">
                    <span class="text-primary shrink-0">{'>'}</span>
                    <span class="text-foreground"><span class="animate-cursor-blink">_</span></span>
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
  <section id="features" class="border-t border-border bg-sidebar">
    <div class="max-w-6xl mx-auto px-6 py-24 md:py-32" use:observe={'features'}>
      <h2 class="text-2xl md:text-3xl font-bold text-center mb-14 {visible['features'] ? 'animate-fade-in-up' : 'opacity-0'}">
        Built for parallel AI coding
      </h2>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        {#each features as feature, i}
          <div class="bg-card border border-border p-7 {visible['features'] ? `animate-fade-in-up delay-${i + 1}` : 'opacity-0'}">
            <div class="flex items-start gap-4">
              <!-- Pixel art icons -->
              <div class="shrink-0 mt-0.5">
                {#if feature.icon === 'worktree'}
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--color-primary)" style="image-rendering: pixelated;">
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
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--color-primary)" style="image-rendering: pixelated;">
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
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--color-primary)" style="image-rendering: pixelated;">
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
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--color-primary)" style="image-rendering: pixelated;">
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
                <h3 class="text-sm font-semibold mb-1.5">{feature.title}</h3>
                <p class="text-xs text-muted-foreground leading-relaxed">{feature.desc}</p>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- How It Works -->
  <section id="how-it-works" class="border-t border-border">
    <div class="max-w-6xl mx-auto px-6 py-24 md:py-32" use:observe={'steps'}>
      <h2 class="text-2xl md:text-3xl font-bold text-center mb-14 {visible['steps'] ? 'animate-fade-in-up' : 'opacity-0'}">
        How It Works
      </h2>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-10">
        {#each steps as step, i}
          <div class="text-center {visible['steps'] ? `animate-fade-in-up delay-${i + 1}` : 'opacity-0'}">
            <!-- Step number as pixel block (square, no rounding) -->
            <div class="flex justify-center mb-5">
              <span class="w-12 h-12 rounded-none bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold" style="border-radius: 0;">{step.num}</span>
            </div>
            <h3 class="text-sm font-semibold mb-2">{step.title}</h3>
            <p class="text-xs text-muted-foreground leading-relaxed max-w-[240px] mx-auto">{step.desc}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- Tech Stack -->
  <section class="border-t border-border bg-sidebar">
    <div class="max-w-6xl mx-auto px-6 py-16" use:observe={'tech'}>
      <div class="flex flex-wrap justify-center gap-4 text-xs text-muted-foreground {visible['tech'] ? 'animate-fade-in-up' : 'opacity-0'}">
        {#each ['Electron', 'Svelte 5', 'TypeScript', 'xterm.js', 'node-pty', 'Tailwind CSS', 'Claude Code'] as tech}
          <span class="px-4 py-2 border border-border bg-card">{tech}</span>
        {/each}
      </div>
    </div>
  </section>

  <!-- CTA -->
  <section class="border-t border-border pixel-bg relative overflow-hidden">
    {#each Array(20) as _, i}
      <span
        class="blue-pixel absolute"
        style="width:4px;height:4px;top:{Math.round((8+(((i*41+17)*7)%84))/100*300/6)*6}px;left:{Math.round((3+(((i*59+11)*11)%94))/100*1400/6)*6}px;animation-delay:{(i*1.7)%6}s;"
      ></span>
    {/each}

    <div class="max-w-6xl mx-auto px-6 py-24 md:py-28 text-center relative z-10" use:observe={'cta'}>
      <div class="{visible['cta'] ? 'animate-fade-in-up' : 'opacity-0'}">
        <svg width="42" height="48" viewBox="0 0 21 24" fill="none" class="mx-auto mb-6" style="image-rendering: pixelated;">
          {#each treeGreens as p}
            <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
          {/each}
        </svg>
        <h2 class="text-2xl md:text-3xl font-bold mb-4">Start building in parallel</h2>
        <p class="text-sm text-muted-foreground mb-10 max-w-md mx-auto leading-relaxed">
          Free and open source. Download Grove Bench and let your agents work together.
        </p>
        <div class="flex flex-wrap justify-center gap-3">
          <a
            href="https://github.com/alanpjohn/grove-bench/releases"
            target="_blank"
            rel="noopener"
            class="bg-primary text-primary-foreground px-6 py-2.5 text-sm font-medium hover:brightness-110 transition-all inline-flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
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
            class="bg-secondary text-secondary-foreground px-6 py-2.5 text-sm font-medium hover:brightness-110 transition-all"
          >
            Star on GitHub
          </a>
        </div>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="border-t border-border bg-card">
    <div class="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <svg width="11" height="13" viewBox="0 0 21 24" fill="none">
          {#each treeGreens as p}
            <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill}/>
          {/each}
        </svg>
        <span class="text-xs text-muted-foreground">Grove Bench</span>
      </div>
      <div class="flex items-center gap-4">
        <a
          href="https://github.com/alanpjohn/grove-bench"
          target="_blank"
          rel="noopener"
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          GitHub
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
