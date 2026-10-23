import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { Badge } from './badge/index.js';
import { Button } from './button/index.js';
import { Kbd } from './kbd/index.js';
import { Notice } from './notice/index.js';
import { SectionLabel } from './section-label/index.js';
import { PanelHeader } from './panel-header/index.js';
import { Pulse } from './pulse/index.js';
import { Logo } from './logo/index.js';
import { menuItem, menuPanel } from './menu/index.js';
import { tabTrigger } from './tabs/index.js';
import { segmentedItem } from './segmented/index.js';
import KitFixture from './kit-fixture.svelte';

const text = (t: string) => createRawSnippet(() => ({ render: () => `<span>${t}</span>` }));

describe('Button', () => {
  it('has the dense sizes the app uses', () => {
    render(Button, { size: '2xs', variant: 'subtle', children: text('Refresh') });
    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(button).toHaveClass('h-5', 'text-micro', 'border-border');
    // The base's text-sm gives way to the size's text-micro
    expect(button).not.toHaveClass('text-sm');
  });

  it('has a square icon size as tall as the default size', () => {
    render(Button, { size: 'icon', 'aria-label': 'Send', children: text('↑') });
    const button = screen.getByRole('button', { name: 'Send' });
    expect(button).toHaveClass('size-9');
    // None of the default size's padding, which would squeeze the icon
    expect(button).not.toHaveClass('px-4');
  });

  it('keeps hover events when disabled, so its tooltip can say why', () => {
    render(Button, { disabled: true, title: 'Nothing to commit', children: text('Commit') });
    expect(screen.getByRole('button', { name: 'Commit' })).not.toHaveClass('disabled:pointer-events-none');
  });

  it('keeps a text size passed in alongside a colour', () => {
    render(Button, { size: 'xs', class: 'text-micro text-muted-foreground', children: text('Go') });
    expect(screen.getByRole('button', { name: 'Go' })).toHaveClass('text-micro', 'text-muted-foreground');
  });
});

describe('Badge', () => {
  it('defaults to an outlined neutral label', () => {
    render(Badge, { children: text('alpha') });
    const badge = screen.getByText('alpha').parentElement!;
    expect(badge).toHaveClass('border', 'text-micro', 'border-border');
  });

  it('fills solid counts with the tone colour', () => {
    render(Badge, { tone: 'primary', variant: 'solid', count: true, children: text('4') });
    expect(screen.getByText('4').parentElement).toHaveClass('bg-primary', 'text-primary-foreground', 'tabular-nums');
  });
});

describe('Kbd', () => {
  it('shows the keys as a kbd element', () => {
    render(Kbd, { keys: 'Ctrl+R' });
    const kbd = screen.getByText('Ctrl+R');
    expect(kbd.tagName).toBe('KBD');
    expect(kbd).toHaveClass('text-micro');
  });
});

describe('Notice', () => {
  it('announces errors as alerts', () => {
    render(Notice, { tone: 'danger', title: 'Could not save settings', children: text('The file is read-only.') });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save settings');
  });

  it('announces everything else politely', () => {
    render(Notice, { tone: 'warning', title: 'No git identity' });
    expect(screen.getByRole('status')).toHaveTextContent('No git identity');
  });
});

describe('SectionLabel', () => {
  it('renders as the heading level asked for', () => {
    render(SectionLabel, { as: 'h3', children: text('Threads') });
    expect(screen.getByRole('heading', { level: 3, name: 'Threads' })).toHaveClass('uppercase', 'text-muted-foreground');
  });
});

describe('PanelHeader', () => {
  it('shows the title and the actions', () => {
    render(PanelHeader, { title: 'Terminal', actions: createRawSnippet(() => ({ render: () => '<button>Clear</button>' })) });
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });
});

describe('Pulse', () => {
  it('is hidden from screen readers without a label', () => {
    const { container } = render(Pulse, {});
    const pulse = container.querySelector('[data-slot="pulse"]')!;
    expect(pulse).toHaveAttribute('aria-hidden', 'true');
    expect(pulse).toHaveClass('bg-status-working', 'animate-pulse');
  });

  it('names itself when given a label', () => {
    render(Pulse, { tone: 'attention', label: 'Waiting for you', motion: 'none' });
    const pulse = screen.getByRole('img', { name: 'Waiting for you' });
    expect(pulse).toHaveClass('bg-status-attention');
    expect(pulse).not.toHaveClass('animate-pulse');
  });
});

describe('Logo', () => {
  it('is one image named Grove Bench, wordmark or not', () => {
    render(Logo, { wordmark: true });
    expect(screen.getByRole('img', { name: 'Grove Bench' })).toBeInTheDocument();
    expect(screen.getByText('Grove Bench')).toHaveClass('font-pixel');
  });

  it('keeps the tree in proportion', () => {
    const { container } = render(Logo, { height: 24 });
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '21');
    expect(svg).toHaveAttribute('height', '24');
  });
});

describe('class recipes for hand-built controls', () => {
  it('match the components', () => {
    expect(tabTrigger({ active: true })).toContain('border-primary');
    expect(tabTrigger()).toContain('border-transparent');
    expect(segmentedItem({ selected: true })).toContain('bg-accent');
  });
});

describe('menu recipes', () => {
  it('marks the selected row with the primary edge', () => {
    expect(menuItem({ selected: true })).toContain('border-primary');
    expect(menuItem()).toContain('border-transparent');
    expect(menuPanel({ padding: 'content' })).toContain('p-3');
  });
});

describe('Tabs and Segmented', () => {
  it('switches tabs and shows only the active panel', async () => {
    render(KitFixture, {});
    const thread = screen.getByRole('tab', { name: 'Thread' });
    const changes = screen.getByRole('tab', { name: 'Changes' });
    expect(thread).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Thread content')).toBeVisible();
    expect(screen.getByText('Changes content')).not.toBeVisible();

    await fireEvent.click(changes);
    expect(changes).toHaveAttribute('aria-selected', 'true');
    expect(changes).toHaveClass('data-[state=active]:border-primary');
    expect(screen.getByText('Changes content')).toBeVisible();
    expect(screen.getByText('Thread content')).not.toBeVisible();
  });

  it('is a radio group with one option chosen', async () => {
    render(KitFixture, {});
    const group = screen.getByRole('radiogroup', { name: 'Diff view' });
    const split = screen.getByRole('radio', { name: 'Split' });
    expect(screen.getByRole('radio', { name: 'Unified' })).toHaveAttribute('aria-checked', 'true');

    await fireEvent.click(split);
    expect(split).toHaveAttribute('aria-checked', 'true');
    expect(group).toContainElement(split);
  });
});
