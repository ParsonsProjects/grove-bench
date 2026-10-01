/**
 * ACP agents Grove knows how to start, and the user's own (Settings > Agent).
 *
 * Launch commands come from each agent's documentation:
 * - Gemini CLI: `gemini --acp` (google-gemini/gemini-cli, docs/cli/acp-mode.md)
 * - GitHub Copilot CLI: `copilot --acp` (github/copilot-cli, changelog.md)
 * Agents that need a separate ACP wrapper (Codex through codex-acp, for
 * example) are added as custom agents.
 */
import type { AcpAgentSetting } from '../../../shared/types.js';
import type { AcpAgentDefinition } from './acp-adapter.js';

export const ACP_PRESETS: AcpAgentDefinition[] = [
  {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    command: 'gemini',
    args: ['--acp'],
    cliSignIn: {
      accountLabel: 'Google account',
      cliName: 'Gemini CLI',
      command: 'gemini',
      setupUrl: 'https://github.com/google-gemini/gemini-cli',
    },
    installInstructions: 'Install Gemini CLI: https://github.com/google-gemini/gemini-cli',
  },
  {
    id: 'copilot-cli',
    displayName: 'GitHub Copilot CLI',
    command: 'copilot',
    args: ['--acp'],
    cliSignIn: {
      accountLabel: 'GitHub Copilot plan',
      cliName: 'GitHub Copilot CLI',
      command: 'copilot',
      setupUrl: 'https://github.com/github/copilot-cli',
    },
    installInstructions: 'Install GitHub Copilot CLI: https://github.com/github/copilot-cli',
  },
];

/** Adapter ids of the user's own ACP agents carry this prefix, so they can't
 *  take a built-in id. */
export const CUSTOM_ACP_PREFIX = 'acp-';

/** Definitions for the user's own agents. Entries without a command, or that
 *  repeat an id, are skipped. */
export function customAcpAgents(settings: readonly AcpAgentSetting[] | undefined): AcpAgentDefinition[] {
  const out: AcpAgentDefinition[] = [];
  const seen = new Set<string>();
  for (const s of settings ?? []) {
    const command = s.command?.trim();
    const slug = (s.id || s.name || command || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!command || !slug) continue;
    const id = `${CUSTOM_ACP_PREFIX}${slug}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, displayName: s.name?.trim() || command, command, args: s.args ?? [] });
  }
  return out;
}
