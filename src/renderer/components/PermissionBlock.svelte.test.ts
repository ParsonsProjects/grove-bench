import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen } from '@testing-library/svelte';

import PermissionBlock from './PermissionBlock.svelte';
import { settingsStore } from '../stores/settings.svelte.js';

const props = { sessionId: 's1', requestId: 'r1', toolName: 'Bash', toolInput: { command: 'npm install zod' } };

afterEach(() => {
  cleanup();
  settingsStore.current = { ...settingsStore.current, groveCharacters: true };
});

describe('PermissionBlock grove character', () => {
  it('waits with a question mark until answered', () => {
    render(PermissionBlock, { ...props, resolved: false });
    expect(screen.getByRole('img', { name: 'Waiting for you' })).toBeInTheDocument();
  });

  it('shows the outcome once answered', () => {
    render(PermissionBlock, { ...props, resolved: true, decision: 'allow' });
    expect(screen.getByRole('img', { name: 'Allowed' })).toBeInTheDocument();
    cleanup();
    render(PermissionBlock, { ...props, resolved: true, decision: 'deny' });
    expect(screen.getByRole('img', { name: 'Denied' })).toBeInTheDocument();
  });

  it('is left out when grove characters are off', () => {
    settingsStore.current = { ...settingsStore.current, groveCharacters: false };
    render(PermissionBlock, { ...props, resolved: false });
    expect(screen.queryByRole('img', { name: 'Waiting for you' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
  });
});

describe('PermissionBlock timeout', () => {
  it('says nobody answered instead of a plain "denied"', () => {
    render(PermissionBlock, { ...props, resolved: true, decision: 'deny', timedOut: true });
    expect(screen.getByText('no answer after 30 minutes, so it was denied')).toBeInTheDocument();
  });
});

describe('PermissionBlock always-allow button', () => {
  it('says it covers every command, not just this one', () => {
    render(PermissionBlock, { ...props, toolCategory: 'bash', resolved: false });
    const button = screen.getByRole('button', { name: 'Allow all commands' });
    expect(button).toHaveAttribute('title', expect.stringContaining('every shell command'));
    expect(screen.queryByRole('button', { name: 'Always Allow' })).toBeNull();
  });
});
