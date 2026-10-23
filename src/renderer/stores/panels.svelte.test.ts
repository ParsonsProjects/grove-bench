import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { panelStore } from './panels.svelte.js';

beforeEach(() => {
  vi.clearAllMocks();
  panelStore.collapsed = {};
});

describe('panelStore', () => {
  it('starts with every panel open', () => {
    expect(panelStore.isCollapsed('sidebar')).toBe(false);
    expect(panelStore.isCollapsed('changesFiles')).toBe(false);
  });

  it('loads the saved flags', async () => {
    mockGroveBench.getCollapsedPanels.mockResolvedValueOnce({ sidebar: true });
    await panelStore.load();
    expect(panelStore.isCollapsed('sidebar')).toBe(true);
    expect(panelStore.isCollapsed('checkpointList')).toBe(false);
  });

  it('toggles one panel and saves every flag', () => {
    panelStore.toggle('checkpointFiles');
    expect(panelStore.isCollapsed('checkpointFiles')).toBe(true);
    expect(panelStore.isCollapsed('changesFiles')).toBe(false);
    expect(mockGroveBench.setCollapsedPanels).toHaveBeenLastCalledWith({ checkpointFiles: true });

    panelStore.toggle('checkpointFiles');
    expect(mockGroveBench.setCollapsedPanels).toHaveBeenLastCalledWith({ checkpointFiles: false });
  });

  it('keeps a toggle made while the saved flags were loading', async () => {
    let resolve: ((v: Record<string, boolean>) => void) | undefined;
    mockGroveBench.getCollapsedPanels.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const loading = panelStore.load();
    panelStore.toggle('sidebar');
    resolve!({ sidebar: false, changesFiles: true });
    await loading;
    expect(panelStore.isCollapsed('sidebar')).toBe(true);
    expect(panelStore.isCollapsed('changesFiles')).toBe(true);
  });

  it('stays usable when loading fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGroveBench.getCollapsedPanels.mockRejectedValueOnce(new Error('nope'));
    await panelStore.load();
    expect(panelStore.isCollapsed('sidebar')).toBe(false);
    err.mockRestore();
  });
});
