import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { mockGroveBench } from '../../__mocks__/setup.js';
import RegistryAgents from './RegistryAgents.svelte';
import type { RegistryAgentSummary } from '../../../shared/types.js';

const AGENTS: RegistryAgentSummary[] = [
  { id: 'gemini', name: 'Gemini CLI', version: '0.62.0', description: "Google's official CLI for Gemini", install: { command: 'npm install -g @google/gemini-cli@0.62.0' }, launch: { command: 'npx', args: ['-y', '@google/gemini-cli@0.62.0', '--acp'] }, builtIn: true },
  { id: 'codex-acp', name: 'Codex', version: '0.9.0', description: 'OpenAI Codex over ACP', install: { command: 'npm install -g @zed-industries/codex-acp@0.9.0' }, launch: { command: 'npx', args: ['-y', '@zed-industries/codex-acp@0.9.0'] }, builtIn: false },
  { id: 'binonly', name: 'Bin Only', version: '1.0.0', install: { download: 'https://example.com/bin.zip' }, launch: null, builtIn: false },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RegistryAgents', () => {
  it('lists the registry\'s agents, searchable, with how to install and use each', async () => {
    mockGroveBench.listRegistryAgents.mockResolvedValue(AGENTS);
    const onUse = vi.fn();
    render(RegistryAgents, { props: { onUse } });

    const list = await screen.findByRole('list', { name: 'ACP Registry agents' });
    expect(list.querySelectorAll('li')).toHaveLength(3);
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search the ACP Registry' }), { target: { value: 'codex' } });
    expect(list.querySelectorAll('li')).toHaveLength(1);

    await fireEvent.click(screen.getByRole('button', { name: /Codex/ }));
    expect(screen.getByRole('group', { name: 'Install Codex' })).toHaveTextContent('npm install -g @zed-industries/codex-acp@0.9.0');
    await fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    expect(onUse).toHaveBeenCalledWith({ name: 'Codex', command: 'npx', args: ['-y', '@zed-industries/codex-acp@0.9.0'] });
  });

  it('says a built-in agent is already there, and offers a download for one without a package', async () => {
    mockGroveBench.listRegistryAgents.mockResolvedValue(AGENTS);
    render(RegistryAgents, { props: { onUse: vi.fn() } });

    await fireEvent.click(await screen.findByRole('button', { name: /Gemini CLI/ }));
    expect(screen.getByText(/Already in Grove Bench/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use' })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: /Bin Only/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Download Bin Only for this computer' }));
    expect(mockGroveBench.openExternal).toHaveBeenCalledWith('https://example.com/bin.zip');
  });

  it('explains an empty list', async () => {
    mockGroveBench.listRegistryAgents.mockResolvedValue([]);
    render(RegistryAgents, { props: { onUse: vi.fn() } });
    expect(await screen.findByText(/Not downloaded yet/)).toBeInTheDocument();
  });
});
