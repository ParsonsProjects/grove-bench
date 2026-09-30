import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, act } from '@testing-library/svelte';

import GroveWalk from './GroveWalk.svelte';
import { agentLook, AGENT_SPRITES } from '../lib/agent-sprite.js';
import { WAKE_AWAKE_AT_MS, WAKE_WALK_AT_MS, ARRIVE_SIT_AT_MS, ARRIVE_TYPE_AT_MS } from '../lib/grove-walk.js';
import { createRawSnippet } from 'svelte';

function reducedMotion(on: boolean) {
  window.matchMedia = vi.fn(() => ({ matches: on }) as MediaQueryList);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  reducedMotion(false);
});

describe('GroveWalk', () => {
  it('keeps the starting text for screen readers and hides the art', () => {
    const { container } = render(GroveWalk, { seed: 'a1b2c3d4' });
    expect(screen.getByText('Starting agent...')).toBeInTheDocument();
    expect(container.querySelector('svg.walk')).toHaveAttribute('aria-hidden', 'true');
  });

  it("draws the conversation's own skin tone and hair colour", () => {
    const seed = 'a1b2c3d4';
    const look = agentLook(seed);
    const { container } = render(GroveWalk, { seed });
    const fills = new Set([...container.querySelectorAll('.strip rect')].map((r) => r.getAttribute('fill')));
    expect(fills).toContain(look.h);
    expect(fills).toContain(look.s);
    // The hoodie takes the sidebar's colour from its svg.
    expect(fills).toContain('currentColor');
  });

  it("wears the sidebar character's colour", () => {
    const { container } = render(GroveWalk, { seed: 's1', spriteState: 'stopped' });
    expect(container.querySelector('.strip')!.closest('svg')).toHaveClass(AGENT_SPRITES.stopped.colorClass);
  });

  it('puts the project colour on the laptop logo while seated', () => {
    const { container } = render(GroveWalk, { seed: 's1', projectColor: '#61afef', wake: { sessionId: 's1', from: 'sleeping', startedAt: Date.now() } });
    const fills = [...container.querySelectorAll('svg.seated rect')].map((r) => r.getAttribute('fill'));
    expect(fills).toContain('#61afef');
  });

  describe('waking up', () => {
    const wake = (from: 'sleeping' | 'stopped') => ({ sessionId: 's1', from, startedAt: Date.now() });

    it("starts asleep on the bench, in the sidebar's colour, with the grove still", () => {
      vi.useFakeTimers();
      const { container } = render(GroveWalk, { seed: 's1', spriteState: 'stopped', wake: wake('stopped') });
      expect(screen.getByText('Waking up...')).toBeInTheDocument();
      expect(screen.getByText('Click or press any key to skip')).toBeInTheDocument();
      const seated = container.querySelector('svg.seated')!;
      expect(seated).toHaveClass(AGENT_SPRITES.stopped.colorClass);
      expect(container.querySelector('svg.walk')).toHaveClass('still');
      expect(container.querySelector('.strip')).toBeNull();
    });

    it('opens its eyes, then walks off and the grove moves', async () => {
      vi.useFakeTimers();
      // A woken sleeping conversation shows as Ready in the sidebar straight away.
      const { container } = render(GroveWalk, { seed: 's1', spriteState: 'ready', wake: wake('sleeping') });
      expect(container.querySelector('svg.seated')).toHaveClass(AGENT_SPRITES.ready.colorClass);

      await act(() => vi.advanceTimersByTime(WAKE_AWAKE_AT_MS));
      expect(container.querySelector('svg.seated')).toHaveClass(AGENT_SPRITES.ready.colorClass);
      expect(screen.getByText('Waking up...')).toBeInTheDocument();

      await act(() => vi.advanceTimersByTime(WAKE_WALK_AT_MS - WAKE_AWAKE_AT_MS));
      expect(container.querySelector('svg.seated')).toBeNull();
      expect(container.querySelector('.strip')).not.toBeNull();
      expect(container.querySelector('.strip')!.closest('svg')).toHaveClass(AGENT_SPRITES.ready.colorClass);
      expect(container.querySelector('svg.walk')).not.toHaveClass('still');
      expect(screen.getByText('Starting agent...')).toBeInTheDocument();
    });

    it('starts the path at its bench', () => {
      const { container } = render(GroveWalk, { seed: 's1', wake: wake('sleeping') });
      const path = container.querySelectorAll('g.layer')[1] as SVGGElement;
      expect(path.style.animationDelay).toMatch(/^-[1-9]/);
    });

    it('walks straight away without a wake-up', () => {
      const { container } = render(GroveWalk, { seed: 's1' });
      expect(container.querySelector('svg.seated')).toBeNull();
      expect(screen.queryByText('Click or press any key to skip')).toBeNull();
      const path = container.querySelectorAll('g.layer')[1] as SVGGElement;
      expect(path.style.animationDelay).toBe('0s');
    });
  });

  describe('arriving', () => {
    const path = (container: HTMLElement) => container.querySelectorAll('g.layer')[1] as SVGGElement;

    it('walks up the path to the bench, which then stays put', async () => {
      vi.useFakeTimers();
      const { container } = render(GroveWalk, { seed: 's1', spriteState: 'starting', arrival: Date.now() });
      expect(container.querySelector('svg.seated')).toBeNull();
      expect(container.querySelector('.strip')).not.toBeNull();
      expect(path(container)).toHaveClass('arriving');
      expect(container.querySelector('svg.walk')).not.toHaveClass('still');

      await act(() => vi.advanceTimersByTime(ARRIVE_SIT_AT_MS));
      expect(path(container)).not.toHaveClass('arriving');
      expect(path(container)).toHaveClass('parked');
      expect(container.querySelector('svg.walk')).toHaveClass('still');
    });

    it('sits down with its laptop, then types once its agent is working', async () => {
      vi.useFakeTimers();
      const arrival = Date.now();
      const { container, rerender } = render(GroveWalk, { seed: 's1', spriteState: 'starting', arrival });
      await act(() => vi.advanceTimersByTime(ARRIVE_SIT_AT_MS));
      const seated = () => container.querySelector('svg.seated')!;
      // Sat down: laptop open, not typing yet, in the sidebar's colour.
      expect(seated()).toHaveClass(AGENT_SPRITES.starting.colorClass);
      expect(seated().querySelector('.strip')).toBeNull();

      // Its agent is working, but it takes a moment to settle first.
      await rerender({ seed: 's1', spriteState: 'working', arrival });
      expect(seated().querySelector('.strip')).toBeNull();

      await act(() => vi.advanceTimersByTime(ARRIVE_TYPE_AT_MS - ARRIVE_SIT_AT_MS));
      expect(seated()).toHaveClass(AGENT_SPRITES.working.colorClass);
      expect(seated().querySelector('.strip')).not.toBeNull();
    });

    it('carries on from where it was when shown again part way through', () => {
      // A frozen clock: under load, rendering can take long enough to move
      // a real one past the expected delay.
      vi.useFakeTimers();
      const { container } = render(GroveWalk, { seed: 's1', arrival: Date.now() - ARRIVE_SIT_AT_MS / 2 });
      expect(path(container)).toHaveClass('arriving');
      expect(path(container).style.animationDelay).toBe('-1.5s');
    });

    it('is already on the bench with reduced motion', () => {
      reducedMotion(true);
      const { container } = render(GroveWalk, { seed: 's1', spriteState: 'working', arrival: Date.now() });
      expect(path(container)).toHaveClass('parked');
      expect(container.querySelector('svg.seated')).toHaveClass(AGENT_SPRITES.working.colorClass);
    });

    it('shows the caption it is given', () => {
      const caption = createRawSnippet(() => ({ render: () => '<p>Thinking...</p>' }));
      render(GroveWalk, { seed: 's1', arrival: Date.now(), caption });
      expect(screen.getByText('Thinking...')).toBeInTheDocument();
      expect(screen.queryByText('Starting agent...')).toBeNull();
      expect(screen.queryByText('Click or press any key to skip')).toBeNull();
    });
  });
});
