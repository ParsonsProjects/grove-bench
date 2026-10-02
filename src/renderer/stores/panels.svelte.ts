import type { CollapsedPanels, CollapsiblePanel } from '../../shared/types.js';

/**
 * Which sidebars are folded down to a thin rail: the main sidebar, the
 * Checkpoints tab's turn list, and each tab's file list. One flag per panel,
 * shared by every conversation, saved in app state so it survives a restart.
 */
class PanelStore {
  collapsed = $state<CollapsedPanels>({});

  async load() {
    try {
      const saved = await window.groveBench.getCollapsedPanels();
      // A toggle made while loading wins over the saved value.
      this.collapsed = { ...saved, ...this.collapsed };
    } catch (e) {
      console.error('Failed to load collapsed panels:', e);
    }
  }

  isCollapsed(panel: CollapsiblePanel): boolean {
    return this.collapsed[panel] ?? false;
  }

  toggle(panel: CollapsiblePanel) {
    this.collapsed = { ...this.collapsed, [panel]: !this.isCollapsed(panel) };
    window.groveBench.setCollapsedPanels($state.snapshot(this.collapsed));
  }
}

export const panelStore = new PanelStore();
