import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import SkillCard from './SkillCard.svelte';

afterEach(cleanup);

describe('SkillCard', () => {
  it('shows a green square for a skill that can run, and the name with its path', () => {
    const { container } = render(SkillCard, { name: 'triage', nameTitle: '/repo/.agents/skills/triage/SKILL.md' });
    expect(screen.getByText('triage')).toHaveAttribute('title', '/repo/.agents/skills/triage/SKILL.md');
    expect(container.querySelector('.bg-green-500')).not.toBeNull();
  });

  it('greys the square for one turned off or paused, and strikes a turned-off name', () => {
    const { container } = render(SkillCard, { name: 'old', active: false, struck: true });
    expect(container.querySelector('.bg-green-500')).toBeNull();
    expect(screen.getByText('old')).toHaveClass('line-through');
  });
});
