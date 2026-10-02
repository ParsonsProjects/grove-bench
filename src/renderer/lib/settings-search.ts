import Fuse from 'fuse.js';

/** The Settings panel's sections, in nav order. Each has a grove name, in
 *  keeping with the app, shown with its plain name under it. */
export const SETTINGS_SECTIONS = [
  { id: 'general', grove: 'The grove', label: 'General', description: 'How the app looks and behaves.' },
  { id: 'agents', grove: 'Grovekeepers', label: 'Agents', description: 'Sign-in, models and defaults for each agent, and settings for all of them.' },
  { id: 'permissions', grove: 'The gate', label: 'Permissions', description: 'What agents may do without asking you first.' },
  { id: 'git', grove: 'Branches & roots', label: 'Git & worktrees', description: 'How new conversations get their branch and worktree.' },
  { id: 'notifications', grove: 'Bells', label: 'Notifications', description: 'Desktop notifications and taskbar alerts.' },
  { id: 'background', grove: 'Tending', label: 'Background work', description: 'Project memory, skill suggestions, conversation goals and sleeping idle conversations.' },
  { id: 'mcp', grove: 'Tool shed', label: 'MCP servers', description: 'Servers that give agents extra tools.' },
  { id: 'plugins', grove: 'Seed packets', label: 'Plugins', description: 'Add and manage plugins.' },
  { id: 'privacy', grove: 'Hedges', label: 'Privacy', description: 'Usage data and crash reports.' },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

/** One searchable setting. `id` matches the `data-setting` attribute on the
 *  setting's row, which search scrolls to. */
export interface SettingsEntry {
  id: string;
  section: SettingsSectionId;
  label: string;
  /** Other words people might search for. */
  keywords?: string;
}

export const SETTINGS_INDEX: readonly SettingsEntry[] = [
  { id: 'default-thread-view', section: 'general', label: 'Default thread view', keywords: 'summary focus detailed activity' },
  { id: 'default-diff-view', section: 'general', label: 'Default diff view', keywords: 'unified side-by-side' },
  { id: 'grove-characters', section: 'general', label: 'Show grove characters', keywords: 'pixel sprites status animation' },
  { id: 'project-colors', section: 'general', label: 'Project colors', keywords: 'accent colour repository' },
  { id: 'always-on-top', section: 'general', label: 'Always on top', keywords: 'window' },
  { id: 'spellcheck', section: 'general', label: 'Spell checking', keywords: 'spelling prompt editor' },
  { id: 'updates', section: 'general', label: 'Updates', keywords: 'version check for updates releases' },
  { id: 'auto-download-updates', section: 'general', label: 'Download updates automatically', keywords: 'install background restart' },

  { id: 'credentials', section: 'agents', label: 'Credentials', keywords: 'api key sign in login authentication' },
  { id: 'default-model', section: 'agents', label: 'Default model', keywords: 'opus sonnet haiku' },
  { id: 'background-model', section: 'agents', label: 'Background model', keywords: 'cheap model memory commit messages' },
  { id: 'default-controls', section: 'agents', label: 'Default permission mode, effort, thinking and speed', keywords: 'ask plan edit auto read-safe fast' },
  { id: 'system-prompt', section: 'agents', label: 'System prompt append', keywords: 'custom instructions' },
  { id: 'working-directories', section: 'agents', label: 'Additional working directories', keywords: 'folders paths access' },
  { id: 'acp-agents', section: 'agents', label: 'Other agents (ACP)', keywords: 'agent client protocol gemini copilot codex custom add' },
  { id: 'alpha-agents', section: 'agents', label: 'Enable an alpha agent', keywords: 'experimental testing opencode open models deepseek openrouter' },
  { id: 'response-style', section: 'agents', label: 'Response style', keywords: 'caveman terse brief tokens' },
  { id: 'thinking-summaries', section: 'agents', label: 'Show thinking summaries', keywords: 'reasoning' },
  { id: 'preview-agent-tools', section: 'agents', label: 'Let the agent use the Preview browser', keywords: 'screenshot browser tools' },

  { id: 'allow-rules', section: 'permissions', label: 'Tool allow rules', keywords: 'approve shell bash commands' },
  { id: 'deny-rules', section: 'permissions', label: 'Tool deny rules', keywords: 'block' },

  { id: 'default-base-branch', section: 'git', label: 'Default base branch', keywords: 'main master' },
  { id: 'branch-naming-rule', section: 'git', label: 'Branch naming rule', keywords: 'branch name ticket' },
  { id: 'auto-install-deps', section: 'git', label: 'Auto-install dependencies', keywords: 'npm install' },

  { id: 'notify-turn-complete', section: 'notifications', label: 'Agent finishes a turn', keywords: 'done' },
  { id: 'notify-permission', section: 'notifications', label: 'Agent is waiting on a permission or question', keywords: 'needs you' },
  { id: 'notify-pr-alert', section: 'notifications', label: 'PR activity', keywords: 'pull request ci review comments' },
  { id: 'notify-test', section: 'notifications', label: 'Send a test notification', keywords: 'check working focus assist do not disturb' },
  { id: 'taskbar-flash', section: 'notifications', label: 'Flash the taskbar button' },
  { id: 'taskbar-badge', section: 'notifications', label: 'Badge the taskbar icon', keywords: 'count' },

  { id: 'memory-auto-save', section: 'background', label: 'Auto-save project memory' },
  { id: 'memory-auto-compact', section: 'background', label: 'Auto-compact project memory' },
  { id: 'memory-compact-timeout', section: 'background', label: 'Compaction timeout', keywords: 'memory seconds' },
  { id: 'skill-suggestions', section: 'background', label: 'Suggest skills automatically' },
  { id: 'conversation-goal', section: 'background', label: 'Show the conversation goal', keywords: 'summary thread pinned' },
  { id: 'idle-sleep', section: 'background', label: 'Sleep idle conversations', keywords: 'idle stop cpu memory minutes' },

  { id: 'mcp-servers', section: 'mcp', label: 'Configured MCP servers', keywords: 'approve remove health' },
  { id: 'mcp-add', section: 'mcp', label: 'Add MCP server', keywords: 'stdio http sse json' },

  { id: 'plugins', section: 'plugins', label: 'Plugins', keywords: 'installed discover install marketplace' },

  { id: 'analytics', section: 'privacy', label: 'Send anonymous usage data', keywords: 'analytics telemetry' },
  { id: 'crash-reports', section: 'privacy', label: 'Send crash reports', keywords: 'errors' },
];

// The section's names count too, so "notif" or "bells" finds every
// notification setting.
const fuse = new Fuse(
  SETTINGS_INDEX.map((entry) => {
    const section = SETTINGS_SECTIONS.find((s) => s.id === entry.section)!;
    return { entry, label: entry.label, keywords: entry.keywords ?? '', section: `${section.grove} ${section.label}` };
  }),
  {
    keys: [{ name: 'label', weight: 2 }, 'keywords', { name: 'section', weight: 0.5 }],
    // Stricter than Fuse's default (0.6), so "idle" doesn't also find "side-by-side".
    threshold: 0.2,
    ignoreLocation: true,
  },
);

/** Settings matching `query`, best first, limited to the sections shown. */
export function searchSettings(query: string, sections: readonly SettingsSectionId[]): SettingsEntry[] {
  const q = query.trim();
  if (!q) return [];
  return fuse.search(q).map((r) => r.item.entry).filter((e) => sections.includes(e.section));
}
