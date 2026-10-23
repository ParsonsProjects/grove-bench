import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen } from '@testing-library/svelte';

import FilePickerPopup from './FilePickerPopup.svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
const scrollIntoView = vi.fn();

let sessionCounter = 0;

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
  mockGroveBench.listFiles.mockResolvedValue(Array.from({ length: 30 }, (_, i) => `f${String(i).padStart(2, '0')}.ts`));
});

afterEach(() => {
  cleanup();
});

async function renderPicker(query = '') {
  const onselect = vi.fn();
  // A fresh session id per test: the listing cache is module-level.
  const { component } = render(FilePickerPopup, { sessionId: `picker-${sessionCounter++}`, query, onselect, onclose: vi.fn() });
  await flush();
  return { component, onselect };
}

const key = (k: string) => new KeyboardEvent('keydown', { key: k, cancelable: true });
const selected = () => screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true');

describe('FilePickerPopup', () => {
  it('moves the selection with the arrow keys and scrolls it into view', async () => {
    const { component } = await renderPicker();
    for (let i = 0; i < 14; i++) component.handleKeydown(key('ArrowDown'));
    await flush();

    expect(selected()).toHaveTextContent('f14.ts');
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(selected());
  });

  it('selects the highlighted file with Enter', async () => {
    const { component, onselect } = await renderPicker();
    component.handleKeydown(key('ArrowDown'));
    component.handleKeydown(key('ArrowDown'));
    expect(component.handleKeydown(key('Enter'))).toBe(true);
    expect(onselect).toHaveBeenCalledWith('f02.ts');
  });

  it('leaves Enter to the prompt when nothing matches', async () => {
    const { component, onselect } = await renderPicker('zzz-nothing');
    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(component.handleKeydown(key('Enter'))).toBe(false);
    expect(onselect).not.toHaveBeenCalled();
  });

  it('moves the selection to the row under the mouse', async () => {
    await renderPicker();
    const row = screen.getAllByRole('option')[5];
    row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await flush();
    expect(selected()).toBe(row);
  });
});
