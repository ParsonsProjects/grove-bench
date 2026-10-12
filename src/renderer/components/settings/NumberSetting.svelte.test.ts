import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';

import NumberSetting from './NumberSetting.svelte';

afterEach(cleanup);

async function type(text: string) {
  const input = screen.getByLabelText('Limit');
  await fireEvent.input(input, { target: { value: text } });
  await fireEvent.blur(input);
}

describe('NumberSetting', () => {
  it('saves whole numbers only, by default', async () => {
    const onchange = vi.fn();
    render(NumberSetting, { setting: 'x', label: 'Limit', unit: 'calls', value: 0, onchange });
    await type('2.5');
    expect(onchange).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter a whole number/)).toBeInTheDocument();
    await type('3');
    expect(onchange).toHaveBeenCalledWith(3);
  });

  it('takes dollars and cents with `cents`', async () => {
    const onchange = vi.fn();
    render(NumberSetting, { setting: 'x', label: 'Limit', unit: 'USD', cents: true, value: 0, onchange });
    await type('2.50');
    expect(onchange).toHaveBeenCalledWith(2.5);
    await type('1.234');
    expect(onchange).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/with up to 2 decimal places/)).toBeInTheDocument();
  });
});
