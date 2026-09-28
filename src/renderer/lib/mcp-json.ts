import type { McpAddServerOpts } from '../../shared/types.js';

/** A server parsed from pasted JSON, ready to add once a scope is picked. */
export type ParsedMcpServer = Omit<McpAddServerOpts, 'scope' | 'cwd'>;

export type McpJsonParseResult =
  | { ok: true; servers: ParsedMcpServer[] }
  | { ok: false; error: string };

/** The CLI's own rule for server names (`claude mcp add` rejects the rest). */
const NAME_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Parse an MCP server config pasted from a README or another client. Accepts
 * the usual shapes:
 *   { "mcpServers": { "name": { ... } } }   (Claude Desktop, .mcp.json)
 *   { "servers": { "name": { ... } } }      (VS Code)
 *   { "name": { ... } }
 *   { "command": ... } or { "url": ... }    (named by `fallbackName`)
 * Each server becomes the same options the add form produces, so it goes
 * through `claude mcp add` like any other.
 */
export function parseMcpJson(text: string, fallbackName = ''): McpJsonParseResult {
  if (!text.trim()) return { ok: false, error: 'Paste a JSON server config' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!isObject(data)) return { ok: false, error: 'Expected a JSON object' };

  let entries: Array<[string, unknown]>;
  const wrapped = isObject(data.mcpServers) ? data.mcpServers : isObject(data.servers) ? data.servers : null;
  if (wrapped) {
    entries = Object.entries(wrapped);
  } else if (looksLikeServer(data)) {
    const name = fallbackName.trim();
    if (!name) return { ok: false, error: 'This config has no server name. Enter one in the Name field.' };
    entries = [[name, data]];
  } else {
    entries = Object.entries(data);
  }
  if (entries.length === 0) return { ok: false, error: 'No servers found in the JSON' };

  const servers: ParsedMcpServer[] = [];
  for (const [name, config] of entries) {
    const parsed = toServer(name, config);
    if ('error' in parsed) return { ok: false, error: parsed.error };
    servers.push(parsed);
  }
  return { ok: true, servers };
}

function toServer(name: string, config: unknown): ParsedMcpServer | { error: string } {
  if (!NAME_RE.test(name)) {
    return { error: `"${name}": server names can only contain letters, numbers, hyphens and underscores` };
  }
  if (!isObject(config)) return { error: `"${name}": expected an object with "command" or "url"` };

  const type = typeof config.type === 'string' ? config.type.toLowerCase() : undefined;
  const transport = type === undefined
    ? (typeof config.command === 'string' ? 'stdio' : typeof config.url === 'string' ? 'http' : undefined)
    : type === 'stdio' ? 'stdio'
    : type === 'sse' ? 'sse'
    : type === 'http' || type === 'streamable-http' || type === 'streamablehttp' ? 'http'
    : undefined;
  if (!transport) {
    return { error: type ? `"${name}": transport "${config.type}" is not supported (use stdio, http or sse)` : `"${name}": needs a "command" or a "url"` };
  }

  if (transport === 'stdio') {
    if (typeof config.command !== 'string' || !config.command.trim()) return { error: `"${name}": "command" must be a string` };
    const args = config.args ?? [];
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) return { error: `"${name}": "args" must be a list of strings` };
    const env = stringRecord(config.env);
    if (env === null) return { error: `"${name}": "env" must map names to string values` };
    return {
      name,
      transport,
      commandOrUrl: config.command.trim(),
      ...(args.length > 0 ? { args: args as string[] } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }

  if (typeof config.url !== 'string' || !config.url.trim()) return { error: `"${name}": "url" must be a string` };
  const headers = stringRecord(config.headers);
  if (headers === null) return { error: `"${name}": "headers" must map names to string values` };
  const headerLines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  return {
    name,
    transport,
    commandOrUrl: config.url.trim(),
    ...(headerLines.length > 0 ? { headers: headerLines } : {}),
  };
}

function looksLikeServer(o: Record<string, unknown>): boolean {
  return typeof o.command === 'string' || typeof o.url === 'string';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A string-to-string map, `{}` when absent, null when malformed. */
function stringRecord(v: unknown): Record<string, string> | null {
  if (v === undefined) return {};
  if (!isObject(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== 'string') return null;
    out[k] = val;
  }
  return out;
}
