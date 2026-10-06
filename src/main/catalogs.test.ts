import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('./logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

import {
  ACP_REGISTRY_URL, CATALOG_MAX_AGE_MS, Catalogs, MODELS_DEV_URL,
  findModel, installFor, launchFor, parseRegistry, registryPlatform, svgDataUrl, trimModelsDev,
} from './catalogs.js';

// Entries as the registry publishes them (agentclientprotocol/registry,
// <id>/agent.json, fetched 5 October 2026), with the CDN's icon URL.
const GEMINI = {
  id: 'gemini', name: 'Gemini CLI', version: '0.62.0', description: "Google's official CLI for Gemini",
  repository: 'https://github.com/google-gemini/gemini-cli', website: 'https://geminicli.com',
  authors: ['Google'], license: 'Apache-2.0',
  distribution: { npx: { package: '@google/gemini-cli@0.62.0', args: ['--acp'] } },
};
const COPILOT = {
  id: 'github-copilot-cli', name: 'GitHub Copilot', version: '1.0.91',
  distribution: { npx: { package: '@github/copilot@1.0.91', args: ['--acp'] } },
};
const OPENCODE = {
  id: 'opencode', name: 'OpenCode', version: '1.18.34',
  icon: 'https://cdn.agentclientprotocol.com/registry/v1/latest/opencode.svg',
  distribution: { binary: {
    'windows-x86_64': { archive: 'https://github.com/anomalyco/opencode/releases/download/v1.18.34/opencode-windows-x64.zip', cmd: './opencode.exe', args: ['acp'] },
    'linux-x86_64': { archive: 'https://github.com/anomalyco/opencode/releases/download/v1.18.34/opencode-linux-x64.tar.gz', cmd: './opencode', args: ['acp'] },
    'darwin-aarch64': { archive: 'not a url', cmd: './opencode' },
    'darwin-x86_64': { archive: 'javascript:alert(1)', cmd: './opencode' },
  } },
};

describe('parseRegistry', () => {
  it('reads the agents, leaving out entries and builds that don\'t fit', () => {
    const agents = parseRegistry({ version: '1.0.0', agents: [GEMINI, COPILOT, OPENCODE, { id: 'broken' }, { ...GEMINI, id: 'nodist', distribution: {} }], extensions: [] });
    expect(agents.map((a) => a.id)).toEqual(['gemini', 'github-copilot-cli', 'opencode']);
    expect(Object.keys(agents[2].distribution.binary!)).toEqual(['windows-x86_64', 'linux-x86_64']);
    expect(parseRegistry(null)).toEqual([]);
  });

  it('gives an install command for npm and Python packages, and a download for builds', () => {
    const [gemini, , opencode] = parseRegistry({ agents: [GEMINI, COPILOT, OPENCODE] });
    expect(installFor(gemini)).toEqual({ command: 'npm install -g @google/gemini-cli@0.62.0' });
    expect(installFor(opencode, 'windows-x86_64')).toEqual({ download: OPENCODE.distribution.binary['windows-x86_64'].archive });
    expect(installFor(opencode, 'windows-aarch64')).toBeNull();
    const uv = parseRegistry({ agents: [{ id: 'py', name: 'Py', version: '1', distribution: { uvx: { package: 'py-agent@1' } } }] })[0];
    expect(installFor(uv)).toEqual({ command: 'uv tool install py-agent@1' });
    expect(launchFor(gemini)).toEqual({ command: 'npx', args: ['-y', '@google/gemini-cli@0.62.0', '--acp'] });
    expect(launchFor(opencode)).toBeNull();
  });

  it('names platforms the registry\'s way', () => {
    expect(registryPlatform('win32', 'x64')).toBe('windows-x86_64');
    expect(registryPlatform('darwin', 'arm64')).toBe('darwin-aarch64');
    expect(registryPlatform('linux', 'x64')).toBe('linux-x86_64');
  });
});

describe('models.dev', () => {
  const API = {
    openrouter: { id: 'openrouter', name: 'OpenRouter', env: ['OPENROUTER_API_KEY'], models: {
      'deepseek/deepseek-v4.1-flash': { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', reasoning: true, cost: { input: 0.03, output: 0.6 }, limit: { context: 1048576, output: 65536 } },
    } },
    google: { id: 'google', models: { 'gemini-2.5-pro': { name: 'Gemini 2.5 Pro', limit: { context: 1048576, output: 65536 } } } },
    empty: { id: 'empty', models: {} },
  };

  it('keeps limits, prices and names', () => {
    expect(trimModelsDev(API)).toEqual({
      openrouter: { 'deepseek/deepseek-v4.1-flash': { name: 'DeepSeek V4.1 Flash', context: 1048576, output: 65536, costIn: 0.03, costOut: 0.6, reasoning: true } },
      google: { 'gemini-2.5-pro': { name: 'Gemini 2.5 Pro', context: 1048576, output: 65536 } },
    });
  });

  it('finds a model by provider, by OpenCode\'s provider/model id, or anywhere', () => {
    const data = trimModelsDev(API);
    expect(findModel(data, 'gemini-2.5-pro', 'google')?.context).toBe(1048576);
    expect(findModel(data, 'openrouter/deepseek/deepseek-v4.1-flash')?.costIn).toBe(0.03);
    expect(findModel(data, 'gemini-2.5-pro')?.name).toBe('Gemini 2.5 Pro');
    expect(findModel(data, 'nope')).toBeNull();
  });
});

describe('Catalogs', () => {
  let dir: string;
  let now: number;
  const answers = new Map<string, unknown>();
  const fetchFn = vi.fn(async (url: string) => {
    const body = answers.get(url);
    return { ok: body !== undefined, status: body === undefined ? 503 : 200, json: async () => body, text: async () => String(body) };
  });
  const make = () => new Catalogs({ dir: () => dir, fetchFn, now: () => now });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogs-'));
    now = 1_000_000;
    answers.clear();
    fetchFn.mockClear();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('fetches both lists, keeps them for the next launch, and fetches again only after a day', async () => {
    answers.set(ACP_REGISTRY_URL, { version: '1', agents: [GEMINI] });
    answers.set(MODELS_DEV_URL, { google: { models: { 'gemini-2.5-pro': { limit: { context: 1000 } } } } });
    const first = make();
    const changed = vi.fn();
    first.onChange(changed);
    await first.refresh();
    expect(first.registryAgent('gemini')?.version).toBe('0.62.0');
    expect(first.model('gemini-2.5-pro', 'google')?.context).toBe(1000);
    expect(changed).toHaveBeenCalledTimes(1);

    const next = make();
    expect(next.registryAgent('gemini')?.name).toBe('Gemini CLI');
    await next.refresh();
    expect(fetchFn).toHaveBeenCalledTimes(2);

    now += CATALOG_MAX_AGE_MS + 1;
    await next.refresh();
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('reads the disk once when there is no copy, and runs a forced refresh after a routine one', async () => {
    const catalogs = make();
    const read = vi.spyOn(fs, 'readFileSync');
    catalogs.registry();
    catalogs.registry();
    catalogs.models();
    catalogs.models();
    // One try per file, even though neither exists.
    expect(read).toHaveBeenCalledTimes(2);
    read.mockRestore();

    answers.set(ACP_REGISTRY_URL, { agents: [GEMINI] });
    answers.set(MODELS_DEV_URL, { google: { models: { g: { limit: { context: 5 } } } } });
    await catalogs.refresh();
    const routine = catalogs.refresh();
    const forced = catalogs.refresh(true);
    await Promise.all([routine, forced]);
    // The routine one fetched nothing (both copies are fresh); the forced one fetched both.
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('keeps the last copy when a fetch fails', async () => {
    answers.set(ACP_REGISTRY_URL, { agents: [GEMINI] });
    const catalogs = make();
    await catalogs.refresh();
    answers.clear();
    await catalogs.refresh(true);
    expect(catalogs.registry().map((a) => a.id)).toEqual(['gemini']);
    expect(catalogs.models()).toEqual({});
  });

  it('takes icons only from the registry\'s CDN, and only small SVGs', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="currentColor" d="M0 0h16v16H0z"/></svg>';
    answers.set(OPENCODE.icon, svg);
    const [opencode] = parseRegistry({ agents: [OPENCODE] });
    const catalogs = make();
    expect(await catalogs.icon(opencode, { download: false })).toBeNull();
    expect(await catalogs.icon(opencode)).toBe(svgDataUrl(svg));
    // Once fetched it is on disk, so it shows with online lookups off too.
    expect(await catalogs.icon(opencode, { download: false })).toBe(svgDataUrl(svg));
    expect(await catalogs.icon({ ...opencode, icon: 'https://evil.example/x.svg' })).toBeNull();
    expect(svgDataUrl('<html><script>alert(1)</script></html>')).toBeNull();
    expect(svgDataUrl(`<svg>${'x'.repeat(40_000)}</svg>`)).toBeNull();
  });
});
