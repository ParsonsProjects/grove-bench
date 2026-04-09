import gettingStarted from '../../../docs/help/getting-started.md?raw';
import sidebar from '../../../docs/help/sidebar.md?raw';
import sessionStates from '../../../docs/help/session-states.md?raw';
import activityTab from '../../../docs/help/activity-tab.md?raw';
import changesTab from '../../../docs/help/changes-tab.md?raw';
import checkpointsTab from '../../../docs/help/checkpoints-tab.md?raw';
import terminalTab from '../../../docs/help/terminal-tab.md?raw';
import statusBar from '../../../docs/help/status-bar.md?raw';
import promptEditor from '../../../docs/help/prompt-editor.md?raw';
import settings from '../../../docs/help/settings.md?raw';
import memory from '../../../docs/help/memory.md?raw';
import keyboardShortcuts from '../../../docs/help/keyboard-shortcuts.md?raw';

export interface HelpTopic {
  id: string;
  title: string;
  section: string;
  content: string;
}

export const topics: HelpTopic[] = [
  { id: 'getting-started', title: 'Getting Started', section: 'Getting Started', content: gettingStarted },
  { id: 'sidebar', title: 'Sidebar & Repositories', section: 'Interface', content: sidebar },
  { id: 'session-states', title: 'Session States & Colors', section: 'Interface', content: sessionStates },
  { id: 'activity-tab', title: 'Activity Tab', section: 'Interface', content: activityTab },
  { id: 'changes-tab', title: 'Changes Tab', section: 'Interface', content: changesTab },
  { id: 'checkpoints-tab', title: 'Checkpoints Tab', section: 'Interface', content: checkpointsTab },
  { id: 'terminal-tab', title: 'Terminal Tab', section: 'Interface', content: terminalTab },
  { id: 'status-bar', title: 'Status Bar', section: 'Interface', content: statusBar },
  { id: 'prompt-editor', title: 'Prompt Editor', section: 'Interface', content: promptEditor },
  { id: 'settings', title: 'Settings', section: 'Features', content: settings },
  { id: 'memory', title: 'Project Memory', section: 'Features', content: memory },
  { id: 'keyboard-shortcuts', title: 'Keyboard Shortcuts', section: 'Features', content: keyboardShortcuts },
];
