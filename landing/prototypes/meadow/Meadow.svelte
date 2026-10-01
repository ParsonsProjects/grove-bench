<script>
  import { onMount } from 'svelte';
  import '../day/day.css';
  import Nav from '../day/Nav.svelte';
  import Hero from '../day/Hero.svelte';
  import Founder from '../day/Founder.svelte';
  import Features from '../day/Features.svelte';
  import Steps from '../day/Steps.svelte';
  import Free from '../day/Free.svelte';
  import Faq from '../day/Faq.svelte';
  import Closing from '../day/Closing.svelte';
  import Footer from '../day/Footer.svelte';
  import Divider from './Divider.svelte';
  import { trackScroll } from '../day/scroll.svelte.js';

  onMount(trackScroll);

  // The grove between sections fills in as the day goes on: each strip keeps
  // what was there and adds new trees (worktrees) and agents.
  const A = { id: 'a3f8b2c1', tint: '#3b82f6', tag: 'feat/auth' };
  const B = { id: 'e52b9a73', tint: '#6ec87a', tag: 'fix/login' };
  const C = { id: '9b0e27f5', tint: '#f59e0b', tag: 'docs/readme' };
  const D = { id: '1d6f4c08', tint: '#a78bfa', tag: 'feat/search' };

  const tree = (x, s, o = {}) => ({ k: 'tree', x, s, ...o });
  const bench = (x, who, state, o = {}) => ({ k: 'bench', x, id: who.id, state, ...o });
  const lamp = (x, o = {}) => ({ k: 'lamp', x, ...o });

  const DIVIDERS = [
    {
      top: 'var(--c1)',
      bottom: 'var(--c1)',
      note: '08:30 · one project, on main',
      grass: [0, 8],
      items: [lamp(38), tree(48, 5, { tag: 'main' }), bench(56, A, 'ready', { new: true, from: 'right' })],
    },
    {
      top: 'var(--c2)',
      bottom: 'var(--c2)',
      note: '09:00 · three conversations, three worktrees',
      grass: [8, 26],
      items: [
        tree(48, 5, { tag: 'main' }),
        tree(22, 3, { tint: A.tint, tag: A.tag, new: true }),
        tree(70, 3, { tint: B.tint, tag: B.tag, new: true }),
        tree(84, 3, { tint: C.tint, tag: C.tag, new: true }),
        bench(28, A, 'working', { new: true }),
        bench(76, B, 'working', { new: true, from: 'right' }),
        bench(90, C, 'working', { new: true, from: 'right' }),
      ],
    },
    {
      top: 'var(--c3)',
      bottom: 'var(--c3)',
      note: '11:00 · one needs you',
      grass: [26, 44],
      items: [
        tree(48, 5),
        tree(22, 3, { tint: A.tint }),
        tree(70, 3, { tint: B.tint }),
        tree(84, 3, { tint: C.tint }),
        tree(8, 3, { tint: D.tint, tag: D.tag, new: true }),
        tree(36, 2, { new: true }),
        bench(28, A, 'working'),
        bench(76, B, 'permission'),
        bench(90, C, 'working'),
        bench(14, D, 'working', { new: true }),
      ],
    },
    {
      top: 'var(--c4)',
      bottom: 'var(--c4)',
      note: '15:00 · finished while you were away',
      grass: [44, 64],
      items: [
        tree(48, 5),
        tree(22, 3, { tint: A.tint }),
        tree(70, 3, { tint: B.tint }),
        tree(84, 3, { tint: C.tint }),
        tree(8, 3, { tint: D.tint }),
        tree(36, 2),
        tree(60, 4, { new: true }),
        tree(96, 2, { new: true }),
        bench(28, A, 'unread'),
        bench(76, B, 'working'),
        bench(90, C, 'ready'),
        bench(14, D, 'unread'),
        lamp(42, { new: true }),
      ],
    },
    {
      top: 'var(--c5)',
      bottom: 'var(--c6)',
      ground: '#2f6e3a',
      sun: true,
      height: 220,
      note: '19:30 · idle ones nap; the lamps come on',
      grass: [64, 86],
      items: [
        tree(48, 5),
        tree(22, 3, { tint: A.tint }),
        tree(70, 3, { tint: B.tint }),
        tree(84, 3, { tint: C.tint }),
        tree(8, 3, { tint: D.tint }),
        tree(36, 2),
        tree(60, 4),
        tree(96, 2),
        bench(28, A, 'sleeping'),
        bench(76, B, 'unread'),
        bench(90, C, 'sleeping'),
        bench(14, D, 'sleeping'),
        lamp(42, { lightUp: true }),
        lamp(66, { lightUp: true }),
        lamp(3, { lightUp: true }),
      ],
    },
  ];
</script>

<div class="day">
  <Nav />
  <main>
    <Hero title={['one developer,', 'a whole grove of agents.']} lede="Grove Bench is a free Windows app that runs several AI coding agents on one project at once. Each gets its own git worktree, branch and terminal, so they never trip over each other." />
    <Divider {...DIVIDERS[0]} />
    <Founder />
    <Divider {...DIVIDERS[1]} />
    <Features />
    <Divider {...DIVIDERS[2]} />
    <Steps />
    <Divider {...DIVIDERS[3]} />
    <Free />
    <Divider {...DIVIDERS[4]} />
    <Faq />
    <Closing />
  </main>
  <Footer />
</div>
