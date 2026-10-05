/**
 * Public lists Grove reads instead of keeping its own:
 *
 * - The ACP Registry (github.com/agentclientprotocol/registry): agents that
 *   speak ACP, their latest version and how each is distributed (an npm
 *   package run with npx, a Python package run with uvx, or a download per
 *   platform). Built hourly and served from its CDN as one registry.json,
 *   `{ version, agents, extensions }` (.github/workflows/build_registry.py).
 * - models.dev (github.com/sst/models.dev, MIT): models by provider, each
 *   with its context and output limits and price per million tokens. The
 *   API is one api.json keyed by provider id, each with a `models` map.
 *
 * Each is fetched at most once a day, only while Settings > Privacy > "Look
 * up agents and models online" is on, trimmed to the fields Grove reads and
 * kept in userData/catalogs, so the last copy works offline. The built-in
 * agents keep their own install commands (presets.ts) for when there is no
 * copy. Grove shows the registry's install commands; it never runs them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, net } from 'electron';
import { z } from 'zod';
import { logger } from './logger.js';
import { readJsonFile, writeFileAtomicSync } from './json-file.js';

export const ACP_REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
export const MODELS_DEV_URL = 'https://models.dev/api.json';
/** How old a saved copy may get before the next launch fetches a new one. */
export const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;
/** Registry icons are 16x16 SVGs; anything bigger isn't one. */
const MAX_ICON_BYTES = 32 * 1024;

// ─── ACP Registry ───

const launchSchema = z.object({
  package: z.string().min(1),
  args: z.array(z.string()).optional(),
});
const binarySchema = z.object({
  // Opened in the browser from Settings, so only https.
  archive: z.string().url().refine((u) => u.startsWith('https://')),
  cmd: z.string().min(1),
  args: z.array(z.string()).optional(),
});
const registryAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string(),
  description: z.string().optional(),
  website: z.string().optional(),
  repository: z.string().optional(),
  icon: z.string().optional(),
  distribution: z.object({
    npx: launchSchema.optional().catch(undefined),
    uvx: launchSchema.optional().catch(undefined),
    binary: z.record(z.string(), z.unknown()).optional().catch(undefined),
  }),
});

type Launch = z.infer<typeof launchSchema>;
type Binary = z.infer<typeof binarySchema>;

export interface RegistryAgent {
  id: string;
  name: string;
  version: string;
  description?: string;
  website?: string;
  repository?: string;
  icon?: string;
  distribution: { npx?: Launch; uvx?: Launch; binary?: Record<string, Binary> };
}

/** The agents in a registry.json. Entries (and platform builds) that don't
 *  fit the format are left out, so one bad entry doesn't lose the rest. */
export function parseRegistry(raw: unknown): RegistryAgent[] {
  const agents = (raw as { agents?: unknown } | null)?.agents;
  if (!Array.isArray(agents)) return [];
  const out: RegistryAgent[] = [];
  for (const entry of agents) {
    const parsed = registryAgentSchema.safeParse(entry);
    if (!parsed.success) continue;
    const { binary: rawBinary, ...rest } = parsed.data.distribution;
    const binary: Record<string, Binary> = {};
    for (const [platform, build] of Object.entries(rawBinary ?? {})) {
      const ok = binarySchema.safeParse(build);
      if (ok.success) binary[platform] = ok.data;
    }
    const distribution = { ...rest, ...(Object.keys(binary).length > 0 ? { binary } : {}) };
    if (!distribution.npx && !distribution.uvx && !distribution.binary) continue;
    out.push({ ...parsed.data, distribution });
  }
  return out;
}

/** The registry's name for this computer's platform. */
export function registryPlatform(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux';
  return `${os}-${arch === 'arm64' ? 'aarch64' : 'x86_64'}`;
}

/** How to get an agent onto this computer: a command to copy (npm or uv), or
 *  a download to fetch, or null when the registry has neither for it. */
export function installFor(agent: RegistryAgent, platform = registryPlatform()): { command: string } | { download: string } | null {
  const { npx, uvx, binary } = agent.distribution;
  if (npx) return { command: `npm install -g ${npx.package}` };
  if (uvx) return { command: `uv tool install ${uvx.package}` };
  const build = binary?.[platform];
  return build ? { download: build.archive } : null;
}

/** How Grove would start the agent: the registry's npx or uvx line, which
 *  downloads the package the first time it runs. Null for downloads, where
 *  the program's location is up to the user. */
export function launchFor(agent: RegistryAgent): { command: string; args: string[] } | null {
  const { npx, uvx } = agent.distribution;
  if (npx) return { command: 'npx', args: ['-y', npx.package, ...(npx.args ?? [])] };
  if (uvx) return { command: 'uvx', args: [uvx.package, ...(uvx.args ?? [])] };
  return null;
}

// ─── models.dev ───

export interface CatalogModel {
  name?: string;
  /** Context window, in tokens. */
  context?: number;
  /** Most output tokens per reply. */
  output?: number;
  /** USD per million input tokens. */
  costIn?: number;
  /** USD per million output tokens. */
  costOut?: number;
  reasoning?: boolean;
}

/** provider id → model id → what Grove reads about it. */
export type ModelCatalogData = Record<string, Record<string, CatalogModel>>;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/** Keep the parts of models.dev's api.json Grove reads. */
export function trimModelsDev(raw: unknown): ModelCatalogData {
  const out: ModelCatalogData = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [providerId, provider] of Object.entries(raw as Record<string, unknown>)) {
    const models = (provider as { models?: unknown } | null)?.models;
    if (!models || typeof models !== 'object') continue;
    const trimmed: Record<string, CatalogModel> = {};
    for (const [modelId, m] of Object.entries(models as Record<string, Record<string, unknown>>)) {
      if (!m || typeof m !== 'object') continue;
      const limit = (m.limit ?? {}) as Record<string, unknown>;
      const cost = (m.cost ?? {}) as Record<string, unknown>;
      const entry: CatalogModel = {
        ...(typeof m.name === 'string' ? { name: m.name } : {}),
        ...(num(limit.context) !== undefined ? { context: num(limit.context) } : {}),
        ...(num(limit.output) !== undefined ? { output: num(limit.output) } : {}),
        ...(num(cost.input) !== undefined ? { costIn: num(cost.input) } : {}),
        ...(num(cost.output) !== undefined ? { costOut: num(cost.output) } : {}),
        ...(typeof m.reasoning === 'boolean' ? { reasoning: m.reasoning } : {}),
      };
      if (Object.keys(entry).length > 0) trimmed[modelId] = entry;
    }
    if (Object.keys(trimmed).length > 0) out[providerId] = trimmed;
  }
  return out;
}

/**
 * Find a model: under `provider` when given, then as `provider/model` (how
 * OpenCode names them, e.g. "openrouter/deepseek/deepseek-v4.1-flash"), then
 * under any provider that lists that exact id.
 */
export function findModel(data: ModelCatalogData, modelId: string, provider?: string): CatalogModel | null {
  if (provider && data[provider]?.[modelId]) return data[provider][modelId];
  const slash = modelId.indexOf('/');
  if (slash > 0) {
    const hit = data[modelId.slice(0, slash)]?.[modelId.slice(slash + 1)];
    if (hit) return hit;
  }
  for (const models of Object.values(data)) if (models[modelId]) return models[modelId];
  return null;
}

// ─── Fetching and keeping ───

type FetchFn = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

interface Saved<T> { fetchedAt: number; data: T }

interface CatalogOptions {
  dir?: () => string;
  fetchFn?: FetchFn;
  now?: () => number;
}

export class Catalogs {
  private registryCopy: Saved<RegistryAgent[]> | null | undefined;
  private modelsCopy: Saved<ModelCatalogData> | null | undefined;
  private refreshing: Promise<void> | null = null;
  private readonly dir: () => string;
  private readonly fetchFn: FetchFn;
  private readonly now: () => number;
  private listeners = new Set<() => void>();

  constructor(opts: CatalogOptions = {}) {
    this.dir = opts.dir ?? (() => path.join(app.getPath('userData'), 'catalogs'));
    this.fetchFn = opts.fetchFn ?? ((url, init) => net.fetch(url, init));
    this.now = opts.now ?? Date.now;
  }

  /** The registry's agents, from the last copy (empty without one). */
  registry(): RegistryAgent[] {
    this.registryCopy ??= this.load<RegistryAgent[]>('acp-registry.json', (v) => (Array.isArray(v) ? parseRegistry({ agents: v }) : null));
    return this.registryCopy?.data ?? [];
  }

  registryAgent(id: string | undefined): RegistryAgent | null {
    return id ? this.registry().find((a) => a.id === id) ?? null : null;
  }

  registryFetchedAt(): number | null {
    this.registry();
    return this.registryCopy?.fetchedAt ?? null;
  }

  /** models.dev, from the last copy (empty without one). */
  models(): ModelCatalogData {
    this.modelsCopy ??= this.load<ModelCatalogData>('models-dev.json', (v) => (v && typeof v === 'object' ? v as ModelCatalogData : null));
    return this.modelsCopy?.data ?? {};
  }

  model(modelId: string, provider?: string): CatalogModel | null {
    return findModel(this.models(), modelId, provider);
  }

  /** Called after a fetch brings new lists. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Fetch whichever list is older than a day (or both, with `force`).
   *  Failures keep the last copy and are only logged. */
  refresh(force = false): Promise<void> {
    this.refreshing ??= this.doRefresh(force).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async doRefresh(force: boolean): Promise<void> {
    const stale = (saved: Saved<unknown> | null | undefined) => force || !saved || this.now() - saved.fetchedAt > CATALOG_MAX_AGE_MS;
    this.registry();
    this.models();
    let changed = false;
    if (stale(this.registryCopy)) {
      const raw = await this.fetchJson(ACP_REGISTRY_URL);
      const agents = raw === null ? [] : parseRegistry(raw);
      if (agents.length > 0) {
        this.registryCopy = this.save('acp-registry.json', agents);
        changed = true;
      }
    }
    if (stale(this.modelsCopy)) {
      const raw = await this.fetchJson(MODELS_DEV_URL);
      const data = raw === null ? {} : trimModelsDev(raw);
      if (Object.keys(data).length > 0) {
        this.modelsCopy = this.save('models-dev.json', data);
        changed = true;
      }
    }
    if (changed) for (const l of this.listeners) l();
  }

  /** A registry icon as a data URL, or null. Only SVG from the registry's
   *  own CDN, small enough to be an icon; shown as a mask, never as markup. */
  async icon(agent: RegistryAgent): Promise<string | null> {
    if (!agent.icon?.startsWith('https://cdn.agentclientprotocol.com/')) return null;
    const file = `icon-${agent.id.replace(/[^a-z0-9-]/gi, '_')}-${agent.version.replace(/[^a-z0-9.-]/gi, '_')}.svg`;
    const cached = path.join(this.dir(), file);
    try {
      if (fs.existsSync(cached)) return svgDataUrl(fs.readFileSync(cached, 'utf8'));
      const res = await this.fetchFn(agent.icon, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) return null;
      const svg = await res.text();
      const url = svgDataUrl(svg);
      if (url) {
        fs.mkdirSync(this.dir(), { recursive: true });
        writeFileAtomicSync(cached, svg);
      }
      return url;
    } catch (e) {
      logger.debug(`[catalogs] icon for ${agent.id} failed:`, e);
      return null;
    }
  }

  private async fetchJson(url: string): Promise<unknown | null> {
    try {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        logger.warn(`[catalogs] ${url} answered ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (e) {
      logger.warn(`[catalogs] could not fetch ${url}:`, e);
      return null;
    }
  }

  private load<T>(file: string, check: (v: unknown) => T | null): Saved<T> | null {
    try {
      const read = readJsonFile(path.join(this.dir(), file));
      if (read.kind !== 'ok') return null;
      const v = read.value as { fetchedAt?: unknown; data?: unknown } | null;
      if (typeof v?.fetchedAt !== 'number') return null;
      const data = check(v.data);
      return data === null ? null : { fetchedAt: v.fetchedAt, data };
    } catch {
      return null;
    }
  }

  private save<T>(file: string, data: T): Saved<T> {
    const saved = { fetchedAt: this.now(), data };
    try {
      fs.mkdirSync(this.dir(), { recursive: true });
      writeFileAtomicSync(path.join(this.dir(), file), JSON.stringify(saved));
    } catch (e) {
      logger.warn(`[catalogs] could not save ${file}:`, e);
    }
    return saved;
  }
}

/** An SVG as a data URL, or null when it doesn't look like a small SVG. */
export function svgDataUrl(svg: string): string | null {
  if (Buffer.byteLength(svg, 'utf8') > MAX_ICON_BYTES || !/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) return null;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

export const catalogs = new Catalogs();
