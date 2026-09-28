import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen } from '@testing-library/svelte';

import GroveWalk from './GroveWalk.svelte';
import { agentLook } from '../lib/agent-sprite.js';

afterEach(() => cleanup());

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
});
