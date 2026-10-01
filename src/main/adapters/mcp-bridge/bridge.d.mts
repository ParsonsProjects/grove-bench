import type { Readable, Writable } from 'node:stream';

export interface BridgeOptions {
  input: Readable;
  output: Writable;
  /** Grove's MCP server for one tool server, e.g. http://127.0.0.1:1234/mcp/grove-memory */
  url: string;
  /** The Authorization header value, `Bearer <token>`. */
  authorization: string;
  fetchImpl?: typeof fetch;
}

export function sseMessages(text: string): unknown[];
export function runBridge(options: BridgeOptions): Promise<void>;
export function main(): Promise<number>;
