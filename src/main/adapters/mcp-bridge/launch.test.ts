import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BRIDGE_BUNDLE_NAME, bridgeScriptPath, stdioBridgeLaunch } from './launch.js';

vi.mock('../../logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

describe('bridgeScriptPath', () => {
  it('uses the bundled bridge next to the main bundle when there is one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-'));
    fs.writeFileSync(path.join(dir, BRIDGE_BUNDLE_NAME), '');
    expect(bridgeScriptPath(dir)).toBe(path.join(dir, BRIDGE_BUNDLE_NAME));
  });

  it('runs the unpacked copy when the bundle is inside app.asar', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-'));
    const unpacked = path.join(root, 'app.asar.unpacked', 'dist', 'main');
    fs.mkdirSync(unpacked, { recursive: true });
    fs.writeFileSync(path.join(unpacked, BRIDGE_BUNDLE_NAME), '');
    expect(bridgeScriptPath(path.join(root, 'app.asar', 'dist', 'main'))).toBe(path.join(unpacked, BRIDGE_BUNDLE_NAME));
  });

  it('falls back to the source entry beside it (tests, no build)', () => {
    expect(bridgeScriptPath(__dirname)).toBe(path.join(__dirname, 'main.mjs'));
  });
});

describe('stdioBridgeLaunch', () => {
  it('starts Grove\'s executable as Node with the endpoint in its environment', () => {
    const launch = stdioBridgeLaunch(
      { name: 'grove-memory', url: 'http://127.0.0.1:5000/mcp/grove-memory', headers: [{ name: 'Authorization', value: 'Bearer abc' }] },
      '/app/bridge.js',
      'linux',
    );
    expect(launch).toEqual({
      name: 'grove-memory',
      command: process.execPath,
      args: ['/app/bridge.js'],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        GROVE_MCP_URL: 'http://127.0.0.1:5000/mcp/grove-memory',
        GROVE_MCP_AUTHORIZATION: 'Bearer abc',
      },
    });
  });

  it('passes SystemRoot on Windows, where sockets need it', () => {
    vi.stubEnv('SystemRoot', 'C:\\Windows');
    const launch = stdioBridgeLaunch({ name: 'grove-memory', url: 'http://127.0.0.1:1/mcp/grove-memory', headers: [] }, '/b.js', 'win32');
    expect(launch.env.SystemRoot).toBe('C:\\Windows');
    vi.unstubAllEnvs();
  });
});
