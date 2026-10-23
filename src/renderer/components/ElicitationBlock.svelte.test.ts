import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';

import ElicitationBlock from './ElicitationBlock.svelte';

const formRequest = {
  serverName: 'deploy',
  message: 'Which environment?',
  mode: 'form' as const,
  requestedSchema: {
    type: 'object',
    properties: {
      env: { type: 'string', title: 'Environment', enum: ['staging', 'prod'] },
      force: { type: 'boolean', title: 'Force' },
    },
    required: ['env'],
  },
};

beforeEach(() => {
  (window.groveBench as { openExternal: unknown }).openExternal = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.mocked(window.groveBench.respondToElicitation).mockClear();
});

describe('ElicitationBlock', () => {
  it('blocks submit until required fields are filled, then sends typed content', async () => {
    render(ElicitationBlock, { sessionId: 's1', requestId: 'e1', request: formRequest, resolved: false });

    await fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(window.groveBench.respondToElicitation).not.toHaveBeenCalled();

    await fireEvent.change(screen.getByLabelText(/Environment/), { target: { value: 'prod' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(window.groveBench.respondToElicitation).toHaveBeenCalledWith('s1', 'e1', {
      action: 'accept',
      content: { env: 'prod', force: false },
    });
  });

  it('sends what the user types into a number field as a number', async () => {
    const request = {
      serverName: 'deploy',
      message: 'How many replicas?',
      mode: 'form' as const,
      requestedSchema: { type: 'object', properties: { replicas: { type: 'integer', title: 'Replicas' } }, required: ['replicas'] },
    };
    render(ElicitationBlock, { sessionId: 's1', requestId: 'e5', request, resolved: false });
    await fireEvent.input(screen.getByLabelText(/Replicas/), { target: { value: '3' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(window.groveBench.respondToElicitation).toHaveBeenCalledWith('s1', 'e5', { action: 'accept', content: { replicas: 3 } });
  });

  it('declines', async () => {
    render(ElicitationBlock, { sessionId: 's1', requestId: 'e2', request: formRequest, resolved: false });
    await fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(window.groveBench.respondToElicitation).toHaveBeenCalledWith('s1', 'e2', { action: 'decline' });
  });

  it('opens the page in URL mode and accepts', async () => {
    const request = { serverName: 'auth', message: 'Sign in to continue', mode: 'url' as const, url: 'https://auth.example/login' };
    render(ElicitationBlock, { sessionId: 's1', requestId: 'e3', request, resolved: false });
    expect(screen.getByText('auth.example')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Open page' }));
    expect(window.groveBench.openExternal).toHaveBeenCalledWith('https://auth.example/login');
    expect(window.groveBench.respondToElicitation).toHaveBeenCalledWith('s1', 'e3', { action: 'accept' });
  });

  it('shows how it ended once resolved', () => {
    render(ElicitationBlock, { sessionId: 's1', requestId: 'e4', request: formRequest, resolved: true, action: 'decline' });
    expect(screen.getByText('declined')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
  });
});
