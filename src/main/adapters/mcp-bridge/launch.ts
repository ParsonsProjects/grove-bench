/**
 * How an agent starts Grove's MCP stdio bridge (bridge.mjs): Grove's own
 * executable in Electron's Node mode (ELECTRON_RUN_AS_NODE), running the
 * bridge script, pointed at one of Grove's MCP servers by environment.
 *
 * Grove's executable is used rather than a `node` on PATH, so the bridge
 * works on machines without Node and runs on the Node version Grove ships.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asarUnpackedPath } from '../../agent-utils.js';
import { logger } from '../../logger.js';
import type { GroveMcpEndpoint } from '../grove-mcp-http.js';

/** The bridge's file name next to the main bundle (vite.main.config.mjs). */
export const BRIDGE_BUNDLE_NAME = 'mcp-stdio-bridge.js';

/**
 * The bridge script to run. In the app this code is part of the main bundle
 * in dist/main, next to the bundled bridge, which electron-builder unpacks
 * from app.asar so another process can run it. From the source tree (tests)
 * it is the entry beside this file.
 */
export function bridgeScriptPath(here = path.dirname(fileURLToPath(import.meta.url))): string {
  const bundled = asarUnpackedPath(path.join(here, BRIDGE_BUNDLE_NAME));
  if (fs.existsSync(bundled)) return bundled;
  const source = path.join(here, 'main.mjs');
  if (!fs.existsSync(source)) logger.warn(`[mcp-bridge] bridge script not found at ${bundled} or ${source}`);
  return source;
}

/** A stdio MCP server entry: the program, its arguments and environment. */
export interface StdioLaunch {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** The stdio server an agent starts to reach `endpoint` through the bridge. */
export function stdioBridgeLaunch(
  endpoint: GroveMcpEndpoint,
  scriptPath = bridgeScriptPath(),
  platform: NodeJS.Platform = process.platform,
): StdioLaunch {
  const authorization = endpoint.headers.find((h) => h.name.toLowerCase() === 'authorization')?.value ?? '';
  const env: Record<string, string> = {
    // Grove's executable starts as plain Node instead of the app.
    ELECTRON_RUN_AS_NODE: '1',
    GROVE_MCP_URL: endpoint.url,
    GROVE_MCP_AUTHORIZATION: authorization,
  };
  // A Windows process started without SystemRoot can't open sockets, and an
  // agent may start MCP servers with only the variables it is given.
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (platform === 'win32' && systemRoot) env.SystemRoot = systemRoot;
  return { name: endpoint.name, command: process.execPath, args: [scriptPath], env };
}
