import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import PreviewPanel from './PreviewPanel.svelte';
import { previewStore } from '../stores/preview.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import type { PreviewPageState } from '../../shared/types.js';

const page = (over: Partial<PreviewPageState> = {}): PreviewPageState => ({
  url: 'http://localhost:5173/', title: 'App', loading: false, canGoBack: false, canGoForward: false, error: null, crashed: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  previewStore.forget('s1');
});

afterEach(() => {
  cleanup();
});

describe('PreviewPanel', () => {
  it('offers URLs seen in the conversation and opens them in your page', async () => {
    previewStore.noteText('s1', 'Local: http://localhost:5173/');
    render(PreviewPanel, { sessionId: 's1', active: true });
    expect(screen.getByText('Preview your app')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'http://localhost:5173/' }));
    expect(mockGroveBench.previewNavigate).toHaveBeenCalledWith('s1', 'user', 'http://localhost:5173/');
  });

  it('navigates from the address bar and shows why a URL was refused', async () => {
    mockGroveBench.previewNavigate.mockRejectedValueOnce(
      new Error("Error invoking remote method 'preview:navigate': Error: \"hello\" isn't a web address."),
    );
    render(PreviewPanel, { sessionId: 's1', active: true });
    const input = screen.getByRole('textbox', { name: 'Address' });
    await fireEvent.input(input, { target: { value: 'hello' } });
    await fireEvent.submit(input.closest('form')!);
    expect(mockGroveBench.previewNavigate).toHaveBeenCalledWith('s1', 'user', 'hello');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('"hello" isn\'t a web address.'));
  });

  it('explains a failed load and retries with a reload', async () => {
    previewStore.applyState('s1', 'user', page({ error: { code: -102, description: 'ERR_CONNECTION_REFUSED', url: 'http://localhost:5173/' } }));
    render(PreviewPanel, { sessionId: 's1', active: true });
    expect(screen.getByText(/Is the dev server running\?/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mockGroveBench.previewCommand).toHaveBeenCalledWith('s1', 'user', 'reload');
  });

  it('keeps the address bar on the page URL', () => {
    previewStore.applyState('s1', 'user', page({ url: 'http://localhost:5173/about' }));
    render(PreviewPanel, { sessionId: 's1', active: true });
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveValue('http://localhost:5173/about');
  });

  it('enables back and forward from the page state', () => {
    previewStore.applyState('s1', 'user', page({ canGoBack: true }));
    render(PreviewPanel, { sessionId: 's1', active: true });
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled();
  });

  it("shows Claude's page with its last action and can open it in yours", async () => {
    previewStore.applyState('s1', 'agent', page({ url: 'http://localhost:5173/login', size: { width: 1280, height: 800 }, lastAction: { text: 'Clicked <button> "sign in"', at: Date.now() } }));
    render(PreviewPanel, { sessionId: 's1', active: true });
    // Claude's first action switched the tab to its page.
    expect(screen.getByRole('button', { name: /Claude's/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1280×800')).toBeInTheDocument();
    expect(screen.getByText(/Clicked <button> "sign in"/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /Open in yours/ }));
    expect(mockGroveBench.previewNavigate).toHaveBeenCalledWith('s1', 'user', 'http://localhost:5173/login');
    await waitFor(() => expect(screen.getByRole('button', { name: /Yours/ })).toHaveAttribute('aria-pressed', 'true'));
  });

  it("explains Claude's empty page and lets you open a seen URL for it", async () => {
    previewStore.setMode('s1', 'agent');
    previewStore.noteText('s1', 'http://localhost:3000/');
    render(PreviewPanel, { sessionId: 's1', active: true });
    expect(screen.getByText(/When Claude checks its work in the browser/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'http://localhost:3000/' }));
    expect(mockGroveBench.previewNavigate).toHaveBeenCalledWith('s1', 'agent', 'http://localhost:3000/');
  });

  it("polls Claude's page for frames only while it's shown", async () => {
    previewStore.setMode('s1', 'agent');
    const { rerender } = render(PreviewPanel, { sessionId: 's1', active: true });
    await waitFor(() => expect(mockGroveBench.previewAgentFrame).toHaveBeenCalled());
    await rerender({ sessionId: 's1', active: false });
    const calls = mockGroveBench.previewAgentFrame.mock.calls.length;
    await new Promise((r) => setTimeout(r, 500));
    expect(mockGroveBench.previewAgentFrame.mock.calls.length).toBe(calls);
  });
});

describe('PreviewPanel with grove characters', () => {
  beforeEach(() => {
    store.sessions = [{ id: 's1', branch: 'feat', repoPath: '/r', status: 'running' }] as any;
  });

  afterEach(() => {
    store.sessions = [];
    settingsStore.current.groveCharacters = true;
  });

  it("puts the conversation's agent on its bench above your empty page, with the seen URLs", async () => {
    previewStore.noteText('s1', 'Local: http://localhost:5173/');
    render(PreviewPanel, { sessionId: 's1', active: true });
    expect(screen.getByText('Preview your app')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Ready' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'http://localhost:5173/' }));
    expect(mockGroveBench.previewNavigate).toHaveBeenCalledWith('s1', 'user', 'http://localhost:5173/');
  });

  it("puts it above Claude's empty page too", () => {
    previewStore.setMode('s1', 'agent');
    render(PreviewPanel, { sessionId: 's1', active: true });
    expect(screen.getByText(/When Claude checks its work in the browser/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Ready' })).toBeInTheDocument();
  });

  it('shows only the text when grove characters are off', () => {
    settingsStore.current.groveCharacters = false;
    render(PreviewPanel, { sessionId: 's1', active: true });
    expect(screen.getByText('Preview your app')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Ready' })).toBeNull();
  });
});
