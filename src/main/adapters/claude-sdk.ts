/**
 * The Claude Agent SDK, for the Claude Code adapter (claude-code.ts) and
 * Grove's tool servers as it serves them (sdk-mcp.ts). Imported on first
 * use, once.
 *
 * Tests mock this module: Vitest's module runner can't run the import below
 * ("A dynamic import callback was not specified").
 */
type ClaudeSdk = typeof import('@anthropic-ai/claude-agent-sdk');

// A real import() of the ESM-only SDK: Vite would turn a plain one into
// require() in main's CommonJS bundle.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<ClaudeSdk>;

let sdk: ClaudeSdk | undefined;

/** The SDK module. An import that fails is tried again on the next call. */
export async function loadClaudeSdk(): Promise<ClaudeSdk> {
  sdk ??= await dynamicImport('@anthropic-ai/claude-agent-sdk');
  return sdk;
}
