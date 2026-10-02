/**
 * ACP agents Grove knows how to start, and the user's own (Settings > Agent).
 *
 * Launch commands come from each agent's documentation:
 * - Gemini CLI: `gemini --acp` (google-gemini/gemini-cli, docs/cli/acp-mode.md)
 * - GitHub Copilot CLI: `copilot --acp` (github/copilot-cli, changelog.md)
 * - OpenCode: `opencode acp` (opencode.ai/docs/acp); its settings and the
 *   OpenRouter key are in opencode.ts
 * Agents that need a separate ACP wrapper (Codex through codex-acp, for
 * example) are added as custom agents.
 */
import crypto from 'node:crypto';
import type { AcpAgentSetting } from '../../../shared/types.js';
import type { AcpAgentDefinition } from './acp-adapter.js';
import { openCodeEnv, verifyOpenRouterKey } from './opencode.js';

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
  {
    id: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
    // Optional: OpenCode also uses the providers the user signed in to with
    // `opencode auth login`. A key saved here makes OpenRouter the provider
    // and DeepSeek V4.1 Flash the starting model.
    apiKey: {
      envVar: 'OPENROUTER_API_KEY',
      label: 'OpenRouter API key',
      helpUrl: 'https://openrouter.ai/keys',
      billingNote: 'Billed by OpenRouter for each request, at the price of the model you pick.',
    },
    verifyApiKey: (key) => verifyOpenRouterKey(key),
    spawnEnv: openCodeEnv,
    installInstructions: 'Install OpenCode: npm install -g opencode-ai (https://opencode.ai/docs)',
  },
];

/** Adapter ids of the user's own ACP agents carry this prefix, so they can't
 *  take a built-in id. */
export const CUSTOM_ACP_PREFIX = 'acp-';

function slugify(text: string | undefined): string {
  return (text ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Definitions for the user's own agents. Entries without a command, or that
 *  repeat an id, are skipped. The id comes from the first of id, name and
 *  command that gives a usable slug, else a hash of the command, so a name
 *  in any script still works and stays the same across launches. */
export function customAcpAgents(settings: readonly AcpAgentSetting[] | undefined): AcpAgentDefinition[] {
  const out: AcpAgentDefinition[] = [];
  const seen = new Set<string>();
  for (const s of settings ?? []) {
    const command = s.command?.trim();
    if (!command) continue;
    const slug = slugify(s.id) || slugify(s.name) || slugify(command)
      || `agent-${crypto.createHash('sha1').update(command).digest('hex').slice(0, 8)}`;
    const id = `${CUSTOM_ACP_PREFIX}${slug}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, displayName: s.name?.trim() || command, command, args: s.args ?? [] });
  }
  return out;
}
