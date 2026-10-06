/**
 * MCP servers Grove gives every ACP agent (Settings > MCP servers), kept in
 * acp-mcp-servers.json in userData.
 *
 * ACP has no way to list or change the servers in an agent's own settings: a
 * client can only hand it servers when a session starts (`mcpServers` on
 * session/new, session/load and session/resume). So this is Grove's own list,
 * shared by all ACP agents, and each agent still loads the servers in its own
 * settings as well.
 * https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/session-setup.mdx
 *
 * Values (environment variables, headers) are stored as typed, like the
 * agents' own MCP settings files.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { z } from 'zod';
import type { McpAddServerOpts, McpConfigScope, McpConfiguredServer, McpSupport } from '../../../shared/types.js';
import { readJsonFile, writeFileAtomicSync } from '../../json-file.js';
import type { AcpMcpServer } from './protocol.js';

/** One saved server. */
export interface AcpMcpServerConfig {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  /** Program (stdio) or URL (http, sse). */
  commandOrUrl: string;
  args?: string[];
  env?: Record<string, string>;
  /** `Name: value` lines (http, sse). */
  headers?: string[];
  /** The project it is for; absent for every project. */
  repoPath?: string;
}

const NAME_PATTERN = '^[A-Za-z0-9_-]+$';
/** Grove's own servers, which every agent gets already. */
const RESERVED_NAMES: ReadonlySet<string> = new Set(['grove-memory', 'grove-preview']);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** An HTTP header name (RFC 9110 token). */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export const ACP_MCP_SUPPORT: McpSupport = {
  // Agents don't report on their servers over ACP, so a thread has nothing to show or change.
  controls: { list: false, reconnect: false, toggle: false, signIn: false, contextCost: false },
  disconnectHint: '',
  config: {
    scopes: [
      { value: 'user', label: 'All projects', description: 'Every ACP agent gets it, in every project' },
      { value: 'local', label: 'One project', description: 'Every ACP agent gets it, in the chosen project only' },
    ],
    namePattern: NAME_PATTERN,
    nameRule: 'Server names can only contain letters, numbers, hyphens and underscores',
    shared: {
      label: 'ACP agents',
      note: "Saved in Grove Bench and given to every ACP agent when a thread starts, on top of the servers in the agent's own settings. Grove Bench can't see whether the agent connected them.",
    },
  },
};

const serverSchema = z.object({
  name: z.string().regex(new RegExp(NAME_PATTERN)),
  transport: z.enum(['stdio', 'http', 'sse']),
  commandOrUrl: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.array(z.string()).optional(),
  repoPath: z.string().min(1).optional(),
});

let cached: AcpMcpServerConfig[] | null = null;

function storePath(): string {
  return path.join(app.getPath('userData'), 'acp-mcp-servers.json');
}

/** The saved list, keeping the entries that are well formed (empty when
 *  missing or damaged), or null when the file can't be read right now. */
function readStore(): AcpMcpServerConfig[] | null {
  const read = readJsonFile(storePath());
  if (read.kind === 'unreadable') return null;
  if (read.kind !== 'ok' || !Array.isArray(read.value)) return [];
  return read.value.flatMap((raw) => {
    const parsed = serverSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Every saved server. An unreadable file reads as none, without caching
 *  that, so the next call tries again. */
export function savedAcpMcpServers(): AcpMcpServerConfig[] {
  if (cached) return cached;
  const list = readStore();
  if (list) cached = list;
  return list ?? [];
}

/** The list to change. Throws when the file can't be read, rather than save
 *  a list that is missing everything in it. */
function storeForUpdate(): AcpMcpServerConfig[] {
  if (cached) return cached;
  const list = readStore();
  if (!list) throw new Error("Couldn't read the saved MCP servers, so nothing was changed. Try again in a moment.");
  cached = list;
  return cached;
}

function save(list: AcpMcpServerConfig[]): void {
  writeFileAtomicSync(storePath(), JSON.stringify(list, null, 2));
  cached = list;
}

/** Test hook: forget the cached list, as at app start. */
export function resetAcpMcpServersCache(): void {
  cached = null;
}

/** Whether a saved server reaches threads in `repoPath` (all-project
 *  servers, and the project's own). */
function appliesTo(server: AcpMcpServerConfig, repoPath: string | null | undefined): boolean {
  return !server.repoPath || (!!repoPath && server.repoPath === repoPath);
}

/** What Settings lists for `repoPath`; undefined lists the all-project ones. */
export function listAcpMcpServers(repoPath?: string): McpConfiguredServer[] {
  return savedAcpMcpServers().filter((s) => appliesTo(s, repoPath)).map((s) => ({
    name: s.name,
    target: s.transport === 'stdio' ? [s.commandOrUrl, ...(s.args ?? [])].join(' ') : s.commandOrUrl,
    transport: s.transport === 'stdio' ? 'stdio' : s.transport.toUpperCase(),
    status: 'unchecked',
  }));
}

/** Check what the renderer sent and turn it into a saved entry. */
export function serverFromOpts(opts: McpAddServerOpts): AcpMcpServerConfig {
  if (!opts || typeof opts !== 'object') throw new Error('Invalid server');
  const name = typeof opts.name === 'string' ? opts.name.trim() : '';
  if (!new RegExp(NAME_PATTERN).test(name)) throw new Error(ACP_MCP_SUPPORT.config!.nameRule);
  if (RESERVED_NAMES.has(name)) throw new Error(`${name} is the name of Grove Bench's own server. Pick another name.`);
  if (opts.scope !== 'user' && opts.scope !== 'local') throw new Error(`Invalid scope: ${String(opts.scope).slice(0, 40)}`);
  const repoPath = opts.scope === 'local' ? opts.cwd : undefined;
  if (opts.scope === 'local' && (typeof repoPath !== 'string' || !repoPath)) throw new Error('Pick the project the server is for.');
  const target = typeof opts.commandOrUrl === 'string' ? opts.commandOrUrl.trim() : '';
  if (!target) throw new Error(opts.transport === 'stdio' ? 'Enter the command that starts the server.' : 'Enter the server\'s URL.');

  if (opts.transport === 'stdio') {
    const args = opts.args ?? [];
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) throw new Error('Invalid arguments');
    const env = opts.env ?? {};
    for (const [key, value] of Object.entries(env)) {
      if (!ENV_NAME.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
      if (typeof value !== 'string') throw new Error(`Invalid value for ${key}`);
    }
    return {
      name, transport: 'stdio', commandOrUrl: target,
      ...(args.length ? { args: [...args] } : {}),
      ...(Object.keys(env).length ? { env: { ...env } } : {}),
      ...(repoPath ? { repoPath } : {}),
    };
  }
  if (opts.transport !== 'http' && opts.transport !== 'sse') throw new Error(`Invalid transport: ${String(opts.transport).slice(0, 40)}`);
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new Error(`Not a URL: ${target}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The URL has to start with http:// or https://');
  const headers = (opts.headers ?? []).map((h) => (typeof h === 'string' ? h.trim() : '')).filter(Boolean);
  for (const header of headers) parseHeader(header);
  return {
    name, transport: opts.transport, commandOrUrl: target,
    ...(headers.length ? { headers } : {}),
    ...(repoPath ? { repoPath } : {}),
  };
}

function parseHeader(line: string): { name: string; value: string } {
  const colon = line.indexOf(':');
  const name = colon > 0 ? line.slice(0, colon).trim() : '';
  if (!HEADER_NAME.test(name) || /[\r\n]/.test(line)) throw new Error(`Write each header as Name: value (got "${line}").`);
  return { name, value: line.slice(colon + 1).trim() };
}

export function addAcpMcpServer(opts: McpAddServerOpts): void {
  const server = serverFromOpts(opts);
  const list = storeForUpdate();
  // Every server a thread gets needs a name of its own: an all-project one
  // can't share a name with any project's, nor a project's with another of
  // that project's.
  const clash = list.find((s) => s.name === server.name && (!server.repoPath || appliesTo(s, server.repoPath)));
  if (clash) throw new Error(`There's already a server called ${server.name}${clash.repoPath ? ' for a project' : ' for all projects'}.`);
  save([...list, server]);
}

/** Remove `name` from `repoPath`'s list: the project's own server, else the
 *  all-project one. `scope` narrows it to one of them. */
export function removeAcpMcpServer(name: string, scope?: McpConfigScope, repoPath?: string): void {
  const list = storeForUpdate();
  const matches = (s: AcpMcpServerConfig, ownProject: boolean) =>
    s.name === name && (ownProject ? !!repoPath && s.repoPath === repoPath : !s.repoPath);
  const index = scope === 'user' ? list.findIndex((s) => matches(s, false))
    : scope === 'local' ? list.findIndex((s) => matches(s, true))
      : [list.findIndex((s) => matches(s, true)), list.findIndex((s) => matches(s, false))].find((i) => i >= 0) ?? -1;
  if (index < 0) throw new Error(`There's no server called ${name} here.`);
  save(list.filter((_, i) => i !== index));
}

/** Where `command` is, as ACP wants it ("the absolute path to the MCP server
 *  executable"): looked up on PATH when it is a bare name, trying PATHEXT's
 *  extensions on Windows. Anything else, or a name not found, is passed on
 *  as typed, for the agent to try. */
export async function resolveCommand(
  command: string,
  {
    env = process.env,
    platform = process.platform,
    isFile = async (file) => (await fs.stat(file)).isFile(),
  }: {
    env?: Readonly<Record<string, string | undefined>>;
    platform?: NodeJS.Platform;
    isFile?: (file: string) => Promise<boolean>;
  } = {},
): Promise<string> {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (p.isAbsolute(command) || /[\\/]/.test(command)) return command;
  const pathVar = (platform === 'win32' ? env.Path ?? env.PATH : env.PATH) ?? '';
  const dirs = pathVar.split(platform === 'win32' ? ';' : ':').filter(Boolean);
  // A bare `npx` on Windows is npm's shell script; the program is npx.cmd.
  const exts = platform === 'win32' && !p.extname(command)
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase())
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = p.join(dir, command + ext);
      if (await isFile(candidate).catch(() => false)) return candidate;
    }
  }
  return command;
}

/** What an agent can be given, from its `mcpCapabilities` at initialize. */
export interface AcpMcpTransports {
  http?: boolean;
  sse?: boolean;
}

/**
 * The saved servers for a thread in `repoPath`, as ACP's `mcpServers`
 * entries. HTTP and SSE servers go only to an agent that says it can connect
 * to them (the protocol says to check); the others are returned as `skipped`.
 */
export async function acpMcpServersFor(
  saved: readonly AcpMcpServerConfig[],
  repoPath: string | null | undefined,
  transports: AcpMcpTransports | null | undefined,
  resolve: (command: string) => Promise<string> = resolveCommand,
): Promise<{ servers: AcpMcpServer[]; skipped: AcpMcpServerConfig[] }> {
  const servers: AcpMcpServer[] = [];
  const skipped: AcpMcpServerConfig[] = [];
  for (const s of saved) {
    if (!appliesTo(s, repoPath)) continue;
    if (s.transport === 'stdio') {
      servers.push({
        name: s.name,
        command: await resolve(s.commandOrUrl),
        args: s.args ?? [],
        env: Object.entries(s.env ?? {}).map(([name, value]) => ({ name, value })),
      });
    } else if (transports?.[s.transport] === true) {
      servers.push({ type: s.transport, name: s.name, url: s.commandOrUrl, headers: (s.headers ?? []).map(parseHeader) });
    } else {
      skipped.push(s);
    }
  }
  return { servers, skipped };
}
