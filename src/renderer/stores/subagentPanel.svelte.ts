import { messageStore } from './messages.svelte.js';
import { dockStore } from './dock.svelte.js';
import type { MessageViewMode } from '../lib/message-view.js';

/** State for the subagent panel (one instance, docked in its thread by
 *  SideDock): which subagent's thread it shows, and the view picked for it. */
class SubagentPanelStore {
  open = $state(false);
  sessionId = $state('');
  /** The Agent call that started the subagent shown. */
  toolUseId = $state('');
  /** The view picked in the panel; until one is, it follows the conversation's. */
  private pickedView = $state<MessageViewMode | null>(null);

  show(sessionId: string, toolUseId: string): void {
    this.sessionId = sessionId;
    this.toolUseId = toolUseId;
    this.open = true;
    dockStore.raise('subagent');
  }

  close(): void {
    this.open = false;
    dockStore.drop('subagent');
  }

  isShowing(sessionId: string, toolUseId: string): boolean {
    return this.open && this.sessionId === sessionId && this.toolUseId === toolUseId;
  }

  viewMode(sessionId: string): MessageViewMode {
    return this.pickedView ?? messageStore.getViewMode(sessionId);
  }

  setViewMode(mode: MessageViewMode): void {
    this.pickedView = mode;
  }
}

export const subagentPanelStore = new SubagentPanelStore();
