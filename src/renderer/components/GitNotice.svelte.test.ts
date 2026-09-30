import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import GitNotice from './GitNotice.svelte';
import { store } from '../stores/sessions.svelte.js';

const agents = { 'claude-code': { available: true, authenticated: true } };

beforeEach(() => {
  vi.clearAllMocks();
  store.prerequisites = null;
});

afterEach(() => {
  cleanup();
  store.prerequisites = null;
});

describe('GitNotice', () => {
  it('shows nothing before the first check or when git is fine', () => {
    render(GitNotice);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    store.prerequisites = { git: { available: true, meetsMinimum: true }, agents };
    render(GitNotice);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('explains a missing git without blocking the app', () => {
    store.prerequisites = { git: { available: false }, agents };
    render(GitNotice);
    expect(screen.getByRole('status')).toHaveTextContent('Git was not found. Without it, projects are plain folders');
  });

  it('names the old version', () => {
    store.prerequisites = { git: { available: true, version: 'git version 2.16.5', meetsMinimum: false }, agents };
    render(GitNotice);
    expect(screen.getByRole('status')).toHaveTextContent('git version 2.16.5');
  });

  it('hides once a re-check finds git', async () => {
    store.prerequisites = { git: { available: false }, agents };
    mockGroveBench.checkPrerequisites.mockResolvedValueOnce({ git: { available: true, meetsMinimum: true }, agents });
    render(GitNotice);

    await fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('can be dismissed', async () => {
    store.prerequisites = { git: { available: false }, agents };
    render(GitNotice);

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
