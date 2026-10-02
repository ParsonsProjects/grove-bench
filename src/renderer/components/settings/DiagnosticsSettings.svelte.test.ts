import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { mockGroveBench } from '../../__mocks__/setup.js';
import DiagnosticsSettings from './DiagnosticsSettings.svelte';
import { perfTraceStore } from '../../stores/perfTrace.svelte.js';

beforeEach(() => {
  vi.clearAllMocks();
  perfTraceStore.state = 'idle';
  perfTraceStore.result = null;
  perfTraceStore.error = null;
});

afterEach(() => cleanup());

describe('DiagnosticsSettings', () => {
  it('shows the performance log in the file manager', async () => {
    render(DiagnosticsSettings);
    await fireEvent.click(screen.getByRole('button', { name: 'Show performance log' }));
    expect(mockGroveBench.showPerformanceFile).toHaveBeenCalledWith('log');
  });

  it('records a trace, counting down, then says where it went', async () => {
    let finish!: (r: { name: string; sizeBytes: number; seconds: number }) => void;
    mockGroveBench.recordPerformanceTrace.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    render(DiagnosticsSettings);

    await fireEvent.click(screen.getByRole('button', { name: 'Record 10 seconds' }));
    const recording = screen.getByRole('button', { name: 'Recording... 10 s' });
    expect(recording).toBeDisabled();

    finish({ name: 'trace-2026-10-01T12-00-00-000Z.json', sizeBytes: 12_582_912, seconds: 10 });
    expect(await screen.findByText('Saved trace-2026-10-01T12-00-00-000Z.json (12.0 MB).')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }));
    expect(mockGroveBench.showPerformanceFile).toHaveBeenCalledWith('trace');
    expect(screen.getByRole('button', { name: 'Record 10 seconds' })).toBeEnabled();
  });

  it('says why a trace could not be recorded', async () => {
    mockGroveBench.recordPerformanceTrace.mockRejectedValueOnce(new Error('tracing is already running'));
    render(DiagnosticsSettings);
    await fireEvent.click(screen.getByRole('button', { name: 'Record 10 seconds' }));
    expect(await screen.findByText("Couldn't record a trace: tracing is already running")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show in folder' })).toBeNull();
  });

  it('keeps showing a recording started before Settings was reopened', () => {
    perfTraceStore.state = 'recording';
    perfTraceStore.startedAt = Date.now() - 3500;
    render(DiagnosticsSettings);
    expect(screen.getByRole('button', { name: 'Recording... 7 s' })).toBeDisabled();
  });
});
