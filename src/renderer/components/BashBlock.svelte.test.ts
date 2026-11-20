import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import type { OutputShortened } from '../../shared/types.js';
import BashBlock from './BashBlock.svelte';

const shortened: OutputShortened = { families: ['test'], fullChars: 9000, modelChars: 200, savedTokens: 2200, file: 'C:\\data\\out.txt' };

afterEach(() => {
  cleanup();
});

describe('BashBlock', () => {
  it('shows the full output, with a line saying the agent got a shorter version', () => {
    render(BashBlock, { toolInput: { command: 'npm test' }, result: 'all 60 tests passed', pending: false, shortened });
    expect(screen.getByText('all 60 tests passed')).toBeInTheDocument();
    expect(screen.getByTestId('shortened-note')).toHaveTextContent('The agent got a shorter version of this test output, about 2.2k tokens fewer.');
  });

  it('says nothing of the kind for output it got in full', () => {
    render(BashBlock, { toolInput: { command: 'npm test' }, result: 'all 60 tests passed', pending: false });
    expect(screen.queryByTestId('shortened-note')).toBeNull();
  });

  it('shows the line with the output in Summary, once it is opened', async () => {
    render(BashBlock, { toolInput: { command: 'npm test' }, result: 'all 60 tests passed', pending: false, shortened, summaryMode: true });
    expect(screen.queryByTestId('shortened-note')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /show/ }));
    expect(screen.getByTestId('shortened-note')).toBeInTheDocument();
  });
});
