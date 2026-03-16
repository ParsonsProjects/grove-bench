import { execFile } from 'node:child_process';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { app } from 'electron';
import { logger } from '../logger.js';
import { getSettings } from '../settings.js';
import type { DockerStatus } from '../../shared/types.js';

// ─── Docker path conversion ───

/** Convert a Windows path (C:\Users\...) to Docker Desktop mount format (/c/Users/...) */
export function toDockerPath(p: string): string {
  if (process.platform !== 'win32') return p;
  // C:\Users\foo → /c/Users/foo
  const normalized = p.replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):(\/.*)/);
  if (match) {
    return `/${match[1].toLowerCase()}${match[2]}`;
  }
  return normalized;
}

/** Returns the path to ~/.claude/ on the host */
export function getClaudeConfigDir(): string {
  return path.join(os.homedir(), '.claude');
}

// ─── Docker availability check ───

let cachedStatus: DockerStatus | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

function execFilePromise(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

export async function isDockerAvailable(): Promise<boolean> {
  const status = await checkDockerStatus();
  return status.available;
}

export async function checkDockerStatus(): Promise<DockerStatus> {
  const now = Date.now();
  if (cachedStatus && (now - cachedAt) < CACHE_TTL_MS) {
    return cachedStatus;
  }

  try {
    const { stdout } = await execFilePromise('docker', ['version', '--format', '{{.Server.Version}}']);
    const version = stdout.trim();
    cachedStatus = { available: true, version };
    cachedAt = now;
    return cachedStatus;
  } catch (err: any) {
    const error = err.message?.includes('Cannot connect')
      ? 'Docker Desktop not running'
      : err.code === 'ENOENT'
        ? 'Docker not installed'
        : `Docker unavailable: ${err.message}`;
    cachedStatus = { available: false, error };
    cachedAt = now;
    return cachedStatus;
  }
}

/** Clear the cached Docker status (e.g. after user installs Docker) */
export function clearDockerCache(): void {
  cachedStatus = null;
  cachedAt = 0;
}

// ─── Container auth ───

/**
 * Get a Docker-compatible auth env var.
 *
 * Priority:
 *   1. ANTHROPIC_API_KEY env var
 *   2. CLAUDE_CODE_OAUTH_TOKEN env var
 *   3. Token saved in app settings (from the orchestration dialog input)
 *
 * Returns { key, value } or null if no compatible auth is available.
 */
export function getDockerAuthEnv(): { key: string; value: string } | null {
  if (process.env.ANTHROPIC_API_KEY) {
    return { key: 'ANTHROPIC_API_KEY', value: process.env.ANTHROPIC_API_KEY };
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { key: 'CLAUDE_CODE_OAUTH_TOKEN', value: process.env.CLAUDE_CODE_OAUTH_TOKEN };
  }
  const saved = getSettings().dockerOAuthToken;
  if (saved) {
    return { key: 'CLAUDE_CODE_OAUTH_TOKEN', value: saved };
  }
  return null;
}

// ─── Image management ───

const IMAGE_NAME = 'grove-sandbox';

/** Mutex for image build to prevent concurrent builds */
let buildPromise: Promise<void> | null = null;

export async function ensureSandboxImage(sdkVersion: string, forceRebuild = false): Promise<void> {
  const tag = `${IMAGE_NAME}:${sdkVersion}`;

  if (!forceRebuild) {
    // Check if image exists
    try {
      await execFilePromise('docker', ['image', 'inspect', tag]);
      logger.debug(`[docker] Image ${tag} already exists`);
      return;
    } catch {
      // Image doesn't exist, need to build
    }
  } else {
    logger.info(`[docker] Force rebuilding image: ${tag}`);
  }

  // Use mutex to prevent parallel builds
  if (buildPromise) {
    logger.debug(`[docker] Waiting for existing build to complete`);
    await buildPromise;
    return;
  }

  buildPromise = buildSandboxImage(sdkVersion);
  try {
    await buildPromise;
  } finally {
    buildPromise = null;
  }
}

async function buildSandboxImage(sdkVersion: string): Promise<void> {
  const tag = `${IMAGE_NAME}:${sdkVersion}`;
  logger.info(`[docker] Building sandbox image: ${tag}`);

  // Create temp build context
  const buildDir = path.join(os.tmpdir(), `grove-sandbox-build-${Date.now()}`);
  await mkdir(buildDir, { recursive: true });

  try {
    // Write Dockerfile
    const dockerfile = `FROM node:20-slim
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY worker.mjs .
WORKDIR /workspace
ENTRYPOINT ["node", "/app/worker.mjs"]
`;
    await writeFile(path.join(buildDir, 'Dockerfile'), dockerfile);

    // Write package.json
    const packageJson = JSON.stringify({
      name: 'grove-sandbox-worker',
      type: 'module',
      dependencies: {
        '@anthropic-ai/claude-agent-sdk': sdkVersion,
      },
    }, null, 2);
    await writeFile(path.join(buildDir, 'package.json'), packageJson);

    // Resolve worker.mjs location:
    // - In production: extraResource puts it at process.resourcesPath/worker.mjs
    // - In dev: it's in the source tree at <appPath>/src/main/docker/worker.mjs
    const appPath = app.getAppPath();
    const candidatePaths = [
      path.join(process.resourcesPath || '', 'worker.mjs'),
      path.join(appPath, 'src', 'main', 'docker', 'worker.mjs'),
    ];
    let workerContent: string | null = null;
    for (const candidate of candidatePaths) {
      try {
        workerContent = await readFile(candidate, 'utf-8');
        logger.debug(`[docker] Found worker.mjs at: ${candidate}`);
        break;
      } catch { /* try next */ }
    }
    if (!workerContent) {
      throw new Error(`worker.mjs not found. Searched: ${candidatePaths.join(', ')}`);
    }
    await writeFile(path.join(buildDir, 'worker.mjs'), workerContent);

    // Build image
    await new Promise<void>((resolve, reject) => {
      const proc = execFile('docker', ['build', '-t', tag, '.'], {
        cwd: buildDir,
        timeout: 300_000, // 5 minute timeout for build
      }, (err) => {
        if (err) reject(new Error(`Docker build failed: ${err.message}`));
        else resolve();
      });

      // Log build output
      proc.stdout?.on('data', (data: string) => logger.debug(`[docker-build] ${data.trim()}`));
      proc.stderr?.on('data', (data: string) => logger.debug(`[docker-build] ${data.trim()}`));
    });

    logger.info(`[docker] Successfully built image: ${tag}`);
  } finally {
    // Clean up build context
    await rm(buildDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── Container lifecycle ───

export async function killContainer(name: string): Promise<void> {
  try {
    await execFilePromise('docker', ['kill', name]);
    logger.debug(`[docker] Killed container: ${name}`);
  } catch {
    // Container may not exist or already stopped
  }
}

export async function killAllContainers(prefix: string): Promise<void> {
  try {
    const { stdout } = await execFilePromise('docker', [
      'ps', '-q', '--filter', `name=${prefix}`,
    ]);
    const ids = stdout.trim().split('\n').filter(Boolean);
    if (ids.length > 0) {
      await execFilePromise('docker', ['kill', ...ids]);
      logger.info(`[docker] Killed ${ids.length} container(s) with prefix: ${prefix}`);
    }
  } catch {
    // Docker may not be available or no containers found
  }
}

export async function cleanupOrphanedContainers(): Promise<void> {
  logger.debug('[docker] Cleaning up orphaned containers...');
  await killAllContainers('grove-subtask-');
}

/** Get the SDK version from the installed package */
export function getSDKVersion(): string {
  try {
    // Try to read from node_modules
    const pkgPath = require.resolve('@anthropic-ai/claude-agent-sdk/package.json');
    const pkg = require(pkgPath);
    return pkg.version;
  } catch {
    return '0.2.72'; // fallback
  }
}
