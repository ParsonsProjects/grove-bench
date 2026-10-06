/** A variable name Windows and every shell accept. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Environment variables typed one per line as KEY=value. Blank lines are
 *  skipped, the value is everything after the first `=`, and a later line
 *  replaces an earlier one with the same name. */
export function parseEnvLines(text: string): { env: Record<string, string> } | { error: string } {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return { error: `Write each variable as KEY=value (got "${trimmed}").` };
    const name = trimmed.slice(0, eq).trim();
    if (!ENV_NAME.test(name)) return { error: `${name} isn't a variable name: use letters, numbers and underscores, not starting with a number.` };
    env[name] = trimmed.slice(eq + 1);
  }
  return { env };
}
