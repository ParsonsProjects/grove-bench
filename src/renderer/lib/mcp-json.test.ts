import { describe, it, expect } from 'vitest';
import { parseMcpJson } from './mcp-json.js';

/** Claude Code's rule, as its adapter describes it. */
const CLAUDE_NAMES = { pattern: '^[A-Za-z0-9_-]+$', rule: 'Server names can only contain letters, numbers, hyphens and underscores' };

describe('parseMcpJson()', () => {
  it('reads the mcpServers wrapper used by Claude Desktop and .mcp.json', () => {
    const text = JSON.stringify({
      mcpServers: {
        files: { command: 'npx', args: ['-y', '@acme/files'], env: { ROOT: 'C:\\work' } },
        docs: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer x' } },
      },
    });
    expect(parseMcpJson(text)).toEqual({
      ok: true,
      servers: [
        { name: 'files', transport: 'stdio', commandOrUrl: 'npx', args: ['-y', '@acme/files'], env: { ROOT: 'C:\\work' } },
        { name: 'docs', transport: 'http', commandOrUrl: 'https://example.com/mcp', headers: ['Authorization: Bearer x'] },
      ],
    });
  });

  it('reads the VS Code servers wrapper and a bare name map', () => {
    const vscode = parseMcpJson('{"servers":{"a":{"type":"sse","url":"https://a.example/sse"}}}');
    expect(vscode).toEqual({ ok: true, servers: [{ name: 'a', transport: 'sse', commandOrUrl: 'https://a.example/sse' }] });
    const bare = parseMcpJson('{"b":{"command":"uvx","args":["b-server"]}}');
    expect(bare).toEqual({ ok: true, servers: [{ name: 'b', transport: 'stdio', commandOrUrl: 'uvx', args: ['b-server'] }] });
  });

  it('names a single unwrapped config from the name field', () => {
    expect(parseMcpJson('{"url":"https://x.example/mcp"}', 'x')).toEqual({
      ok: true,
      servers: [{ name: 'x', transport: 'http', commandOrUrl: 'https://x.example/mcp' }],
    });
    expect(parseMcpJson('{"url":"https://x.example/mcp"}')).toMatchObject({ ok: false, needsName: true });
  });

  it('maps streamable-http to http', () => {
    const r = parseMcpJson('{"mcpServers":{"s":{"type":"streamable-http","url":"https://s.example/mcp"}}}');
    expect(r).toMatchObject({ ok: true, servers: [{ transport: 'http' }] });
  });

  it('rejects what the CLI would reject', () => {
    expect(parseMcpJson('not json')).toMatchObject({ ok: false, error: expect.stringMatching(/Not valid JSON/) });
    expect(parseMcpJson('{"mcpServers":{"my.server":{"command":"x"}}}', '', CLAUDE_NAMES)).toMatchObject({ ok: false, error: expect.stringMatching(/letters, numbers/) });
    // Another agent's rule, or none, decides instead
    expect(parseMcpJson('{"mcpServers":{"my.server":{"command":"x"}}}')).toMatchObject({ ok: true });
    expect(parseMcpJson('{"mcpServers":{"w":{"type":"ws","url":"wss://w"}}}')).toMatchObject({ ok: false, error: expect.stringMatching(/not supported/) });
    expect(parseMcpJson('{"mcpServers":{"e":{"command":"x","env":{"N":1}}}}')).toMatchObject({ ok: false, error: expect.stringMatching(/env/) });
    expect(parseMcpJson('{"mcpServers":{}}')).toMatchObject({ ok: false, error: expect.stringMatching(/No servers/) });
  });
});
