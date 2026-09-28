import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, act } from '@testing-library/svelte';

import GroveWalk from './GroveWalk.svelte';
import { agentLook, AGENT_SPRITES } from '../lib/agent-sprite.js';
import { WAKE_AWAKE_AT_MS, WAKE_WALK_AT_MS } from '../lib/grove-walk.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
    // The hoodie takes the "Starting" colour from its svg.
    expect(fills).toContain('currentColor');
  });

  describe('waking up', () => {
    const wake = (from: 'sleeping' | 'stopped') => ({ sessionId: 's1', from, startedAt: Date.now() });

    it('starts asleep on the bench, in the colour of the state it wakes from, with the grove still', () => {
      vi.useFakeTimers();
      const { container } = render(GroveWalk, { seed: 's1', wake: wake('stopped') });
      expect(screen.getByText('Waking up...')).toBeInTheDocument();
      expect(screen.getByText('Click or press any key to skip')).toBeInTheDocument();
      const seated = container.querySelector('svg.seated')!;
      expect(seated).toHaveClass(AGENT_SPRITES.stopped.colorClass);
      expect(container.querySelector('svg.walk')).toHaveClass('still');
      expect(container.querySelector('.strip')).toBeNull();
    });

    it('opens its eyes, then walks off and the grove moves', async () => {
      vi.useFakeTimers();
      const { container } = render(GroveWalk, { seed: 's1', wake: wake('sleeping') });
      expect(container.querySelector('svg.seated')).toHaveClass(AGENT_SPRITES.sleeping.colorClass);

      await act(() => vi.advanceTimersByTime(WAKE_AWAKE_AT_MS));
      expect(container.querySelector('svg.seated')).toHaveClass(AGENT_SPRITES.starting.colorClass);
      expect(screen.getByText('Waking up...')).toBeInTheDocument();

      await act(() => vi.advanceTimersByTime(WAKE_WALK_AT_MS - WAKE_AWAKE_AT_MS));
      expect(container.querySelector('svg.seated')).toBeNull();
      expect(container.querySelector('.strip')).not.toBeNull();
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
});
