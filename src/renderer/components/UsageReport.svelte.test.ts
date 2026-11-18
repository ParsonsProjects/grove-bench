import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import type { UsageSummary, UsageTotals } from '../../shared/types.js';
import { rangeSince } from '../lib/usage-report.js';
import { agentsStore } from '../stores/agents.svelte.js';
import UsageReport from './UsageReport.svelte';

const totals = (usd: number, input: number, output: number, ms: number, turns: number): UsageTotals => ({ usd, input, output, ms, turns });
const none = totals(0, 0, 0, 0, 0);

function summary(extra: Partial<UsageSummary> = {}): UsageSummary {
  return {
    total: totals(3.5, 2_400_000, 61_000, 2 * 3_600_000 + 5 * 60_000, 12),
    byModel: [
      { model: 'claude-opus-5-5', agent: 'claude-code', ...totals(3.2, 2_000_000, 55_000, 2 * 3_600_000, 11) },
      { model: '', agent: 'claude-code', ...totals(0.3, 400_000, 6_000, 5 * 60_000, 1) },
    ],
    byThread: [
      { thread: 't1', title: 'Fix the parser', repoPath: '/code/app', agent: 'claude-code', removed: false, lastAt: Date.now(), ...totals(3, 2_000_000, 50_000, 3_600_000, 10) },
      { thread: 't2', title: 'Old spike', repoPath: '/code/app', agent: 'claude-code', removed: true, ...totals(0.5, 400_000, 11_000, 3_600_000, 2) },
    ],
    undated: none,
    recordingSince: new Date(2026, 10, 2).getTime(),
    backfilling: false,
    ...extra,
  };
}

const api = () => window.groveBench as unknown as { getUsageSummary: ReturnType<typeof vi.fn> };

beforeEach(() => {
  api().getUsageSummary.mockReset();
  api().getUsageSummary.mockResolvedValue(summary());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('UsageReport', () => {
  it('asks for the last 7 days first, and shows the totals', async () => {
    render(UsageReport);
    const shown = await screen.findByTestId('usage-totals');
    expect(api().getUsageSummary).toHaveBeenCalledWith(rangeSince('week'));
    expect(shown).toHaveTextContent('$3.50');
    expect(shown).toHaveTextContent('2.4M');
    expect(shown).toHaveTextContent('61.0k');
    expect(shown).toHaveTextContent('2h 5m');
    expect(shown).toHaveTextContent('12');
  });

  it('lists models, naming turns from before models were recorded', async () => {
    render(UsageReport);
    const table = await screen.findByTestId('usage-by-model');
    expect(within(table).getByText('claude-opus-5-5')).toBeInTheDocument();
    expect(within(table).getByText('Model not recorded')).toBeInTheDocument();
  });

  it('explains Model not recorded only when that row is there', async () => {
    render(UsageReport);
    expect(await screen.findByTestId('usage-unrecorded')).toHaveTextContent('any turn whose agent didn\'t name a model');
    cleanup();

    api().getUsageSummary.mockResolvedValue(summary({ byModel: [summary().byModel[0]] }));
    render(UsageReport);
    await screen.findByTestId('usage-totals');
    expect(screen.queryByTestId('usage-unrecorded')).toBeNull();
  });

  it('asks once on open, even when the agents finish loading after', async () => {
    agentsStore.loaded = false;
    let listed!: (list: unknown[]) => void;
    const listAdapters = vi.spyOn(window.groveBench, 'listAdapters').mockReturnValue(new Promise((resolve) => { listed = resolve; }) as never);
    try {
      render(UsageReport);
      await screen.findByTestId('usage-totals');
      listed([]);
      await waitFor(() => expect(agentsStore.loaded).toBe(true));
      await new Promise((r) => setTimeout(r, 20));
      expect(api().getUsageSummary).toHaveBeenCalledTimes(1);
    } finally {
      listAdapters.mockRestore();
    }
  });

  it('lists threads, marking removed ones', async () => {
    render(UsageReport);
    const rows = await screen.findAllByTestId('usage-thread-row');
    expect(rows[0]).toHaveTextContent('Fix the parser');
    expect(rows[0]).not.toHaveTextContent('removed');
    expect(rows[1]).toHaveTextContent('Old spike');
    expect(rows[1]).toHaveTextContent('removed');
  });

  it('drops the last range\'s figures while the next ones load', async () => {
    render(UsageReport);
    await screen.findByTestId('usage-totals');
    api().getUsageSummary.mockReturnValue(new Promise(() => {}));
    await fireEvent.click(screen.getByRole('radio', { name: 'Today' }));
    await waitFor(() => expect(screen.queryByTestId('usage-totals')).toBeNull());
    expect(screen.getByText('Loading usage…')).toBeInTheDocument();
  });

  it('asks again for another range', async () => {
    render(UsageReport);
    await screen.findByTestId('usage-totals');
    await fireEvent.click(screen.getByRole('radio', { name: 'All time' }));
    await waitFor(() => expect(api().getUsageSummary).toHaveBeenLastCalledWith(null));
    await fireEvent.click(screen.getByRole('radio', { name: 'Today' }));
    await waitFor(() => expect(api().getUsageSummary).toHaveBeenLastCalledWith(rangeSince('today')));
  });

  it('says how many turns have no date in all time', async () => {
    api().getUsageSummary.mockResolvedValue(summary({ undated: totals(0.2, 10, 1, 5, 3) }));
    render(UsageReport);
    await fireEvent.click(await screen.findByRole('radio', { name: 'All time' }));
    expect(await screen.findByTestId('usage-undated')).toHaveTextContent('3 older turns have no date');
  });

  it('says when a range has no turns', async () => {
    api().getUsageSummary.mockResolvedValue(summary({ total: none, byModel: [], byThread: [] }));
    render(UsageReport);
    expect(await screen.findByTestId('usage-empty')).toHaveTextContent('No turns in the last 7 days.');
    await fireEvent.click(screen.getByRole('radio', { name: 'Today' }));
    await waitFor(() => expect(screen.getByTestId('usage-empty')).toHaveTextContent('No turns today.'));
    await fireEvent.click(screen.getByRole('radio', { name: 'All time' }));
    await waitFor(() => expect(screen.getByTestId('usage-empty')).toHaveTextContent('No turns recorded yet.'));
  });

  it('asks again while older threads are being added up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api().getUsageSummary.mockResolvedValueOnce(summary({ backfilling: true }));
    render(UsageReport);
    expect(await screen.findByTestId('usage-backfilling')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1600);
    await waitFor(() => expect(screen.queryByTestId('usage-backfilling')).toBeNull());
    expect(api().getUsageSummary).toHaveBeenCalledTimes(2);
  });

  it('offers to try again when usage can\'t be read', async () => {
    api().getUsageSummary.mockRejectedValueOnce(new Error('gone'));
    render(UsageReport);
    await fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('usage-totals')).toBeInTheDocument();
  });
});
