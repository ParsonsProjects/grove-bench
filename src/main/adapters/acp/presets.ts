/**
 * ACP agents Grove knows how to start, and the user's own (Settings > Agent).
 *
 * Launch commands come from each agent's documentation:
 * - Gemini CLI: `gemini --acp` (google-gemini/gemini-cli, docs/cli/acp-mode.md);
 *   its API key is in gemini.ts
 * - GitHub Copilot CLI: `copilot --acp` (github/copilot-cli, changelog.md).
 *   Its only ACP sign-in method is `copilot login` in a terminal
 *   (github/copilot-cli#3161)
 * - OpenCode: `opencode acp` (opencode.ai/docs/acp); its settings and the
 *   OpenRouter key are in opencode.ts
 * Install commands are the npm packages that provide each command
 * (@google/gemini-cli, @github/copilot and opencode-ai on npm).
 * Agents that need a separate ACP wrapper (Codex through codex-acp, for
 * example) are added as custom agents.
 */
import crypto from 'node:crypto';
import type { AcpAgentSetting } from '../../../shared/types.js';
import type { AcpAgentDefinition } from './acp-adapter.js';
import { openCodeEnv, verifyOpenRouterKey } from './opencode.js';
import { verifyGeminiKey } from './gemini.js';

export const ACP_PRESETS: AcpAgentDefinition[] = [
  {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    command: 'gemini',
    args: ['--acp'],
    registryId: 'gemini',
    modelProvider: 'google',
    cliSignIn: {
      accountLabel: 'Google account',
      // Personal accounts stopped working on 18 June 2026 (gemini.ts).
      accountDetail: 'Gemini Code Assist Standard or Enterprise, or Vertex AI',
      cliName: 'Gemini CLI',
      command: 'gemini',
      setupUrl: 'https://github.com/google-gemini/gemini-cli',
    },
    apiKey: {
      envVar: 'GEMINI_API_KEY',
      label: 'Gemini API key',
      helpUrl: 'https://aistudio.google.com/apikey',
      billingNote: 'Billed by Google through the Gemini API, separately from any Google AI subscription. If Gemini CLI was set to sign in another way, Grove switches it to this key, and Gemini CLI remembers that.',
      authMethodId: 'gemini-api-key',
    },
    verifyApiKey: (key) => verifyGeminiKey(key),
    installCommand: 'npm install -g @google/gemini-cli',
  },
  {
    id: 'copilot-cli',
    displayName: 'GitHub Copilot CLI',
    command: 'copilot',
    args: ['--acp'],
    registryId: 'github-copilot-cli',
    modelProvider: 'github-copilot',
    cliSignIn: {
      accountLabel: 'GitHub Copilot plan',
      cliName: 'GitHub Copilot CLI',
      command: 'copilot login',
      setupUrl: 'https://github.com/github/copilot-cli',
    },
    installCommand: 'npm install -g @github/copilot',
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
    // The registry has downloads for OpenCode, not a package, so the npm
    // command below stays.
    registryId: 'opencode',
    // Not yet run on Windows with a real key (docs/open-model-harnesses-plan.md).
    stage: 'alpha',
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
    installCommand: 'npm install -g opencode-ai',
  },
];

/** Variable names Windows and every shell accept. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Adapter ids of the user's own ACP agents carry this prefix, so they can't
 *  take a built-in id. */
export const CUSTOM_ACP_PREFIX = 'acp-';

function slugify(text: string | undefined): string {
  return (text ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Definitions for the user's own agents. Entries without a command, or that
 *  repeat an id, are skipped, and so are variables with a name no program
 *  could read. The id comes from the first of id, name and command that
 *  gives a usable slug, else a hash of the command, so a name in any script
 *  still works and stays the same across launches. */
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
    const env = Object.fromEntries(Object.entries(s.env ?? {}).filter(([name, value]) => ENV_NAME.test(name) && typeof value === 'string'));
    out.push({
      id, displayName: s.name?.trim() || command, command, args: s.args ?? [],
      ...(Object.keys(env).length > 0 ? { env } : {}),
    });
  }
  return out;
}
