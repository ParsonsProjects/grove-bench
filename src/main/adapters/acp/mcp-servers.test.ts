import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { McpAddServerOpts } from '../../../shared/types.js';
import {
  acpMcpServersFor, addAcpMcpServer, listAcpMcpServers, removeAcpMcpServer, resetAcpMcpServersCache, resolveCommand,
  savedAcpMcpServers, type AcpMcpServerConfig,
} from './mcp-servers.js';

vi.mock('../../logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-mcp-'));
  vi.mocked(app.getPath).mockReturnValue(dir);
  resetAcpMcpServersCache();
});

const stdio = (name: string, extra: Partial<McpAddServerOpts> = {}): McpAddServerOpts =>
  ({ name, transport: 'stdio', commandOrUrl: 'npx', args: ['-y', 'some-server'], scope: 'user', ...extra });

describe('the saved list', () => {
  it('adds, lists and removes servers, and keeps them in a file', () => {
    addAcpMcpServer(stdio('files', { env: { TOKEN: 'abc' } }));
    addAcpMcpServer({ name: 'docs', transport: 'http', commandOrUrl: 'https://example.com/mcp', headers: ['Authorization: Bearer x'], scope: 'local', cwd: '/repo/a' });

    expect(listAcpMcpServers()).toEqual([{ name: 'files', target: 'npx -y some-server', transport: 'stdio', status: 'unchecked' }]);
    expect(listAcpMcpServers('/repo/a').map((s) => [s.name, s.transport])).toEqual([['files', 'stdio'], ['docs', 'HTTP']]);
    expect(listAcpMcpServers('/repo/b').map((s) => s.name)).toEqual(['files']);

    resetAcpMcpServersCache();
    expect(savedAcpMcpServers()).toEqual([
      { name: 'files', transport: 'stdio', commandOrUrl: 'npx', args: ['-y', 'some-server'], env: { TOKEN: 'abc' } },
      { name: 'docs', transport: 'http', commandOrUrl: 'https://example.com/mcp', headers: ['Authorization: Bearer x'], repoPath: '/repo/a' },
    ]);

    removeAcpMcpServer('docs', undefined, '/repo/a');
    removeAcpMcpServer('files');
    expect(savedAcpMcpServers()).toEqual([]);
    expect(() => removeAcpMcpServer('files')).toThrow(/no server called files/);
  });

  it('keeps every name a thread gets its own', () => {
    addAcpMcpServer(stdio('db', { scope: 'local', cwd: '/repo/a' }));
    // Another project may use the name; all projects may not.
    addAcpMcpServer(stdio('db', { scope: 'local', cwd: '/repo/b' }));
    expect(() => addAcpMcpServer(stdio('db'))).toThrow(/already a server called db for a project/);
    addAcpMcpServer(stdio('files'));
    expect(() => addAcpMcpServer(stdio('files', { scope: 'local', cwd: '/repo/a' }))).toThrow(/for all projects/);
    // Removing from one project leaves the other's.
    removeAcpMcpServer('db', 'local', '/repo/a');
    expect(listAcpMcpServers('/repo/b').map((s) => s.name)).toEqual(['db', 'files']);
  });

  it('turns down what it can\'t pass on', () => {
    expect(() => addAcpMcpServer(stdio('has space'))).toThrow(/letters, numbers/);
    expect(() => addAcpMcpServer(stdio('grove-memory'))).toThrow(/Grove Bench's own server/);
    expect(() => addAcpMcpServer(stdio('x', { commandOrUrl: '  ' }))).toThrow(/command/);
    expect(() => addAcpMcpServer(stdio('x', { env: { 'BAD-NAME': '1' } }))).toThrow(/environment variable/);
    expect(() => addAcpMcpServer(stdio('x', { scope: 'project' }))).toThrow(/scope/);
    expect(() => addAcpMcpServer(stdio('x', { scope: 'local' }))).toThrow(/project/);
    const http = (extra: Partial<McpAddServerOpts>): McpAddServerOpts => ({ name: 'h', transport: 'http', commandOrUrl: 'https://example.com', scope: 'user', ...extra });
    expect(() => addAcpMcpServer(http({ commandOrUrl: 'example.com' }))).toThrow(/Not a URL/);
    expect(() => addAcpMcpServer(http({ commandOrUrl: 'file:///etc/passwd' }))).toThrow(/http/);
    expect(() => addAcpMcpServer(http({ headers: ['no colon'] }))).toThrow(/Name: value/);
    expect(savedAcpMcpServers()).toEqual([]);
  });

  it('keeps the good entries of a damaged file', () => {
    fs.writeFileSync(path.join(dir, 'acp-mcp-servers.json'), JSON.stringify([
      { name: 'ok', transport: 'stdio', commandOrUrl: 'srv' },
      { name: 'bad name', transport: 'stdio', commandOrUrl: 'srv' },
      'junk',
    ]));
    expect(savedAcpMcpServers().map((s) => s.name)).toEqual(['ok']);
  });
});

describe('acpMcpServersFor', () => {
  const saved: AcpMcpServerConfig[] = [
    { name: 'files', transport: 'stdio', commandOrUrl: 'npx', args: ['srv'], env: { TOKEN: 'abc' } },
    { name: 'docs', transport: 'http', commandOrUrl: 'https://example.com/mcp', headers: ['Authorization: Bearer x: y'] },
    { name: 'old', transport: 'sse', commandOrUrl: 'https://example.com/sse' },
    { name: 'other', transport: 'stdio', commandOrUrl: 'srv', repoPath: '/repo/b' },
  ];
  const resolve = async (c: string) => `/bin/${c}`;

  it('gives the project\'s servers in ACP\'s shape, with the command found', async () => {
    const { servers, skipped } = await acpMcpServersFor(saved, '/repo/a', { http: true, sse: true }, resolve);
    expect(servers).toEqual([
      { name: 'files', command: '/bin/npx', args: ['srv'], env: [{ name: 'TOKEN', value: 'abc' }] },
      { type: 'http', name: 'docs', url: 'https://example.com/mcp', headers: [{ name: 'Authorization', value: 'Bearer x: y' }] },
      { type: 'sse', name: 'old', url: 'https://example.com/sse', headers: [] },
    ]);
    expect(skipped).toEqual([]);
  });

  it('leaves out what the agent says it can\'t connect to', async () => {
    const { servers, skipped } = await acpMcpServersFor(saved, '/repo/b', { http: true }, resolve);
    expect(servers.map((s) => s.name)).toEqual(['files', 'docs', 'other']);
    expect(skipped.map((s) => s.name)).toEqual(['old']);
    expect((await acpMcpServersFor(saved, null, undefined, resolve)).skipped.map((s) => s.name)).toEqual(['docs', 'old']);
  });
});

describe('resolveCommand', () => {
  it('finds a bare name on PATH, with PATHEXT on Windows', async () => {
    const files = new Set(['C:\\node\\npx', 'C:\\node\\npx.cmd', 'C:\\tools\\srv.exe']);
    const win = { platform: 'win32' as const, env: { Path: 'C:\\empty;C:\\node;C:\\tools', PATHEXT: '.EXE;.CMD' }, isFile: async (f: string) => files.has(f) };
    // Not npm's extensionless shell script, which Windows can't run.
    expect(await resolveCommand('npx', win)).toBe('C:\\node\\npx.cmd');
    expect(await resolveCommand('srv.exe', win)).toBe('C:\\tools\\srv.exe');
    expect(await resolveCommand('missing', win)).toBe('missing');
    expect(await resolveCommand('C:\\x\\y.exe', win)).toBe('C:\\x\\y.exe');
    expect(await resolveCommand('.\\bin\\srv', win)).toBe('.\\bin\\srv');

    const posix = { platform: 'linux' as const, env: { PATH: '/usr/bin:/opt/bin' }, isFile: async (f: string) => f === '/opt/bin/srv' };
    expect(await resolveCommand('srv', posix)).toBe('/opt/bin/srv');
  });
});
