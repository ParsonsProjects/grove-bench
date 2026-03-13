import type { OrchTask, OrchOverlapWarning } from '../shared/types.js';
import { git } from './git.js';
import { logger } from './logger.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ESM dynamic import (same pattern as agent-session.ts)
const dynamicImport = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<typeof import('@anthropic-ai/claude-agent-sdk')>;

let _query: typeof import('@anthropic-ai/claude-agent-sdk').query;
async function getQuery() {
  if (!_query) {
    const sdk = await dynamicImport('@anthropic-ai/claude-agent-sdk');
    _query = sdk.query;
  }
  return _query;
}

export interface RawTask {
  description: string;
  branchName: string;
  scope: string[];
  priority: number;
  parallelizable: boolean;
  dependsOn: string[];
  instruction: string;
}

export const DECOMPOSE_PROMPT = `You are a task decomposer for a coding project. Given a high-level goal and codebase structure, break it down into 2-5 independent tasks that can be executed by separate AI coding agents, each working in their own isolated git worktree branch.

Rules:
- Each task must be self-contained and executable by a single agent
- Minimize overlap between tasks (agents should touch different files when possible)
- Each task's instruction should be detailed enough for an agent to execute without additional context
- Branch names must be valid git branch names (no spaces, use hyphens)
- Use the provided branch prefix for all branch names
- dependsOn references task IDs from your output (task_1, task_2, etc.)
- Mark tasks as parallelizable: true if they can run concurrently

Respond with ONLY a JSON array (no markdown fences, no explanation):
[{
  "description": "short description",
  "branchName": "the-branch-name",
  "scope": ["src/file1.ts", "src/dir/"],
  "priority": 1,
  "parallelizable": true,
  "dependsOn": [],
  "instruction": "Detailed instruction for the agent..."
}]`;

export async function gatherContext(repoPath: string): Promise<string> {
  // Get file listing
  let files: string;
  try {
    const output = await git(['ls-files'], repoPath);
    const lines = output.split('\n').filter(Boolean);
    if (lines.length > 2000) {
      files = lines.slice(0, 2000).join('\n') + `\n... (${lines.length - 2000} more files)`;
    } else {
      files = lines.join('\n');
    }
  } catch {
    files = '(unable to list files)';
  }

  // Try to read README
  let readme = '';
  for (const name of ['README.md', 'README.txt', 'README']) {
    try {
      const content = await fs.readFile(path.join(repoPath, name), 'utf-8');
      readme = content.slice(0, 3000);
      break;
    } catch { /* not found */ }
  }

  // Try to read package.json for project type
  let pkg = '';
  try {
    const content = await fs.readFile(path.join(repoPath, 'package.json'), 'utf-8');
    pkg = content.slice(0, 1000);
  } catch { /* not found */ }

  let context = `Repository: ${repoPath}\n\nFile listing:\n${files}`;
  if (readme) context += `\n\nREADME (truncated):\n${readme}`;
  if (pkg) context += `\n\npackage.json (truncated):\n${pkg}`;
  return context;
}

export function validateTasks(raw: RawTask[], branchPrefix: string): OrchTask[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('Decomposition returned empty or invalid task list');
  }
  if (raw.length > 10) {
    throw new Error(`Too many tasks (${raw.length}), maximum is 10`);
  }

  const taskIds = raw.map((_, i) => `task_${i + 1}`);
  const tasks: OrchTask[] = [];

  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (!t.description || !t.instruction) {
      throw new Error(`Task ${i + 1} is missing description or instruction`);
    }

    // Sanitize branch name
    let branch = t.branchName || `task-${i + 1}`;
    branch = branch.replace(/[^a-zA-Z0-9._/-]/g, '-').replace(/-+/g, '-');
    if (!branch.startsWith(branchPrefix)) {
      branch = `${branchPrefix}/${branch}`;
    }

    // Validate dependsOn references
    const deps = (t.dependsOn || []).filter((d: string) => taskIds.includes(d));

    tasks.push({
      id: `task_${i + 1}`,
      jobId: '', // filled by orchestrator
      description: t.description,
      branchName: branch,
      baseBranch: '', // filled by orchestrator
      scope: Array.isArray(t.scope) ? t.scope : [],
      priority: typeof t.priority === 'number' ? t.priority : i + 1,
      parallelizable: t.parallelizable !== false,
      dependsOn: deps,
      sessionId: null,
      status: 'pending',
      instruction: t.instruction,
      createdAt: Date.now(),
      completedAt: null,
      error: null,
      costUsd: null,
      startedAt: null,
      durationMs: null,
      timeoutMs: null,
      mergeStatus: null,
      mergeError: null,
    });
  }

  // Check for circular dependencies
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function hasCycle(taskId: string): boolean {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    visiting.add(taskId);
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      for (const dep of task.dependsOn) {
        if (hasCycle(dep)) return true;
      }
    }
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  }
  for (const t of tasks) {
    if (hasCycle(t.id)) {
      throw new Error('Circular dependency detected in task graph');
    }
  }

  return tasks;
}

export function detectOverlaps(tasks: OrchTask[]): OrchOverlapWarning[] {
  const warnings: OrchOverlapWarning[] = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const overlap = tasks[i].scope.filter(s =>
        tasks[j].scope.some(s2 => s === s2 || s.startsWith(s2) || s2.startsWith(s))
      );
      if (overlap.length > 0) {
        warnings.push({ taskA: tasks[i].id, taskB: tasks[j].id, files: overlap });
      }
    }
  }
  return warnings;
}

export async function decompose(
  goal: string,
  repoPath: string,
  baseBranch: string,
  jobIdShort: string,
): Promise<OrchTask[]> {
  const context = await gatherContext(repoPath);
  const branchPrefix = `orch/${jobIdShort}`;

  const prompt = `${DECOMPOSE_PROMPT}\n\nBranch prefix: ${branchPrefix}\n\n${context}\n\nGoal: ${goal}`;

  logger.info(`[decomposer] Starting decomposition for: ${goal.slice(0, 100)}`);

  const queryFn = await getQuery();
  const abortController = new AbortController();

  // Abort after 90 seconds to prevent hanging forever
  const abortTimer = setTimeout(() => {
    logger.warn('[decomposer] Aborting — 90s timeout reached');
    abortController.abort();
  }, 90_000);

  let resultText = '';

  try {
    const q = queryFn({
      prompt,
      options: {
        cwd: repoPath,
        abortController,
        permissionMode: 'plan',
        model: 'sonnet',
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        env: {
          ...process.env,
          CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
        },
      },
    });

    for await (const message of q) {
      logger.debug(`[decomposer] message type=${message.type}`);
      if (message.type === 'result' && !message.is_error) {
        resultText = (message as any).result || '';
      } else if (message.type === 'result' && message.is_error) {
        const errors = (message as any).errors || [];
        throw new Error(`Decomposition failed: ${errors.join(', ') || 'unknown error'}`);
      }
    }
  } finally {
    clearTimeout(abortTimer);
  }

  logger.info(`[decomposer] Query completed, resultText length=${resultText.length}`);

  if (!resultText) {
    throw new Error('Decomposition returned no result');
  }

  // Extract JSON from the result (may be wrapped in markdown fences)
  let jsonStr = resultText;
  const fenceMatch = resultText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1];
  }

  let raw: RawTask[];
  try {
    raw = JSON.parse(jsonStr.trim());
  } catch (e) {
    throw new Error(`Failed to parse decomposition JSON: ${(e as Error).message}\nRaw: ${jsonStr.slice(0, 500)}`);
  }

  const tasks = validateTasks(raw, branchPrefix);
  logger.info(`[decomposer] Decomposed into ${tasks.length} tasks`);
  return tasks;
}
