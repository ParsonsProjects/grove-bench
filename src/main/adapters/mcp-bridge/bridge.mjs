// @ts-check
/**
 * Grove Bench's MCP stdio bridge, for agents that can only start MCP servers
 * as programs (stdio) and not connect to one by address (HTTP).
 *
 * The agent starts this script as an ordinary stdio MCP server. It reads one
 * JSON-RPC message per line from stdin, posts each to Grove's own MCP server
 * (grove-mcp-http.ts) with that server's bearer token, and writes the replies
 * to stdout, one per line. All the tools live in Grove; this only carries
 * messages, so it needs nothing but Node's built-ins.
 *
 * Plain JavaScript with no imports beyond Node, so it runs as-is from the
 * source tree in tests and is bundled for the app (main.mjs is the entry).
 */
import { createInterface } from 'node:readline';

/** JSON-RPC "internal error", for a request Grove couldn't answer. */
const INTERNAL_ERROR = -32603;

/**
 * The JSON-RPC messages in a Server-Sent Events body: each event's `data`
 * lines, joined, parsed. Events that aren't JSON are skipped.
 * @param {string} text
 * @returns {unknown[]}
 */
export function sseMessages(text) {
  const out = [];
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) continue;
    try {
      out.push(JSON.parse(data));
    } catch {
      // not a message
    }
  }
  return out;
}

/**
 * Carry messages between `input`/`output` and Grove's MCP server at `url`
 * until `input` ends, then wait for replies still on their way.
 * @param {import('./bridge.d.mts').BridgeOptions} options
 * @returns {Promise<void>}
 */
export async function runBridge({ input, output, url, authorization, fetchImpl = globalThis.fetch }) {
  /** @type {string | null} Sent on every request after initialize, as MCP's HTTP transport asks. */
  let protocolVersion = null;
  /** @type {string | null} Grove's server is stateless, but a session id it sends is echoed. */
  let sessionId = null;

  /** @param {unknown} message */
  const write = (message) => {
    output.write(`${JSON.stringify(message)}\n`);
  };

  /** Answer a request with an error; notifications and responses get none.
   * @param {any} msg @param {string} message */
  const fail = (msg, message) => {
    if (msg && typeof msg.method === 'string' && msg.id !== undefined && msg.id !== null) {
      write({ jsonrpc: '2.0', id: msg.id, error: { code: INTERNAL_ERROR, message } });
    }
  };

  /** Forward one message; anything that goes wrong becomes an error reply,
   *  never an exception that would end the bridge.
   * @param {any} msg */
  async function forward(msg) {
    try {
      await send(msg);
    } catch (e) {
      fail(msg, `Grove Bench's reply was cut off (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  /** @param {any} msg */
  async function send(msg) {
    /** @type {Record<string, string>} */
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization,
    };
    if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion;
    if (sessionId) headers['mcp-session-id'] = sessionId;

    let res;
    try {
      res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(msg) });
    } catch (e) {
      fail(msg, `Grove Bench is not reachable (${e instanceof Error ? e.message : String(e)}). Is the conversation still open?`);
      return;
    }
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    if (res.status === 202 || res.status === 204) return; // a notification, accepted

    const text = await res.text();
    /** @type {unknown[]} */
    let replies = [];
    if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
      replies = sseMessages(text);
    } else if (text.trim()) {
      try {
        const parsed = JSON.parse(text);
        replies = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        // handled below
      }
    }
    if (replies.length === 0) {
      fail(msg, res.ok ? 'Grove Bench sent an empty or unreadable reply' : `Grove Bench answered HTTP ${res.status}`);
      return;
    }
    for (const reply of replies) {
      const r = /** @type {any} */ (reply);
      if (msg.method === 'initialize' && r && r.id === msg.id && typeof r.result?.protocolVersion === 'string') {
        protocolVersion = r.result.protocolVersion;
      }
      write(reply);
    }
  }

  /** @type {Set<Promise<void>>} */
  const inFlight = new Set();
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // MCP stdio carries only JSON-RPC; anything else is noise
    }
    // initialize must finish first: later requests carry the version it agreed.
    if (msg && msg.method === 'initialize') {
      await Promise.allSettled([...inFlight]);
      await forward(msg);
      continue;
    }
    const p = forward(msg).finally(() => inFlight.delete(p));
    inFlight.add(p);
  }
  await Promise.allSettled([...inFlight]);
}

/**
 * Run as a program: the URL and authorization come from the environment the
 * agent was told to start this with (see launch.ts).
 * @returns {Promise<number>} exit code
 */
export async function main() {
  const url = process.env.GROVE_MCP_URL;
  const authorization = process.env.GROVE_MCP_AUTHORIZATION;
  if (!url || !authorization) {
    process.stderr.write('Grove Bench MCP bridge: GROVE_MCP_URL and GROVE_MCP_AUTHORIZATION must be set\n');
    return 2;
  }
  await runBridge({ input: process.stdin, output: process.stdout, url, authorization });
  return 0;
}
