import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import NewAgentDialog from './NewAgentDialog.svelte';
import { store } from '../stores/sessions.svelte.js';
import type { PrerequisiteStatus } from '../../shared/types.js';

const apiKey = (saved: boolean) => ({ label: 'Anthropic API key', helpUrl: 'https://example.com/keys', saved, canStore: true });

const signedOut: PrerequisiteStatus = {
  git: { available: true, meetsMinimum: true },
  agent: { available: true, authenticated: false, apiKey: apiKey(false) },
};
const signedIn: PrerequisiteStatus = {
  git: { available: true, meetsMinimum: true },
  agent: { available: true, authenticated: true, apiKey: apiKey(false) },
};

beforeEach(() => {
  vi.clearAllMocks();
  store.repos = ['/repo/one'];
  store.prerequisites = null;
  mockGroveBench.checkPrerequisites.mockResolvedValue(signedOut);
  mockGroveBench.setApiKey.mockResolvedValue({ ...signedOut, agent: { ...signedOut.agent, apiKey: apiKey(true) } });
});

afterEach(() => {
  cleanup();
  store.repos = [];
  store.prerequisites = null;
});

describe('NewAgentDialog credentials step', () => {
  it('goes straight to the form when the agent is signed in', () => {
    store.prerequisites = signedIn;
    render(NewAgentDialog, { onclose: vi.fn() });

    expect(screen.getByText('Branch Mode')).toBeInTheDocument();
    expect(screen.queryByLabelText('Anthropic API key')).not.toBeInTheDocument();
    expect(mockGroveBench.checkPrerequisites).not.toHaveBeenCalled();
  });

  it('re-checks a cached signed-out state before asking for a key', async () => {
    store.prerequisites = signedOut;
    mockGroveBench.checkPrerequisites.mockResolvedValue(signedIn);
    render(NewAgentDialog, { onclose: vi.fn() });

    expect(mockGroveBench.checkPrerequisites).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('Branch Mode')).toBeInTheDocument());
  });

  it('asks for a key when there are no credentials, then shows the form once saved', async () => {
    store.prerequisites = signedOut;
    render(NewAgentDialog, { onclose: vi.fn() });

    const input = await screen.findByLabelText('Anthropic API key');
    expect(screen.queryByText('Branch Mode')).not.toBeInTheDocument();

    await fireEvent.input(input, { target: { value: 'sk-test-123' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    expect(mockGroveBench.setApiKey).toHaveBeenCalledWith('sk-test-123');
    await waitFor(() => expect(screen.getByText('Branch Mode')).toBeInTheDocument());
  });

  it('shows the save error and stays on the key step', async () => {
    store.prerequisites = signedOut;
    mockGroveBench.setApiKey.mockRejectedValueOnce(
      new Error("Error invoking remote method 'credentials:setApiKey': Error: An API key cannot contain spaces."),
    );
    render(NewAgentDialog, { onclose: vi.fn() });

    const input = await screen.findByLabelText('Anthropic API key');
    await fireEvent.input(input, { target: { value: 'bad key' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('An API key cannot contain spaces.');
    expect(screen.queryByText('Branch Mode')).not.toBeInTheDocument();
  });

  it('lets the user re-check after signing in with the CLI', async () => {
    store.prerequisites = signedOut;
    render(NewAgentDialog, { onclose: vi.fn() });
    await screen.findByLabelText('Anthropic API key');

    mockGroveBench.checkPrerequisites.mockResolvedValue(signedIn);
    await fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));

    await waitFor(() => expect(screen.getByText('Branch Mode')).toBeInTheDocument());
  });
});
