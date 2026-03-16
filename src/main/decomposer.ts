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

/** JSON schema used with outputFormat to force structured decomposition output. */
export const DECOMPOSE_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Short description of the task' },
          branchName: { type: 'string', description: 'Git branch name (use hyphens, prefixed with the branch prefix)' },
          scope: { type: 'array', items: { type: 'string' }, description: 'File paths or directories this task touches' },
          priority: { type: 'number', description: 'Execution priority (1 = highest)' },
          parallelizable: { type: 'boolean', description: 'Whether this task can run concurrently with others' },
          dependsOn: { type: 'array', items: { type: 'string' }, description: 'Task IDs this depends on (task_1, task_2, etc.)' },
          instruction: { type: 'string', description: 'Detailed, self-contained instruction for the coding agent' },
        },
        required: ['description', 'branchName', 'scope', 'priority', 'parallelizable', 'dependsOn', 'instruction'],
      },
      minItems: 2,
      maxItems: 5,
    },
  },
  required: ['tasks'],
};

export const DECOMPOSE_SYSTEM_PROMPT = `You are a task decomposer for a multi-agent coding system. Analyze the codebase context and break the goal into independent sub-tasks for parallel execution by separate AI coding agents.

Each agent works in its own isolated git worktree branch with full codebase access but NO awareness of other agents. After all agents finish, branches are merged.

Rules:
- 2-5 independent tasks
- Each task must be self-contained — the agent receives ONLY the instruction and the codebase
- Minimize file overlap (overlapping files cause merge conflicts)
- Instructions must be specific: exact file paths, function names, expected behavior
- dependsOn references task IDs: task_1, task_2, etc. (assigned in array order)
- Set parallelizable: false ONLY if a task truly cannot start until another finishes`;

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
      progressSummary: null,
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

  const prompt = `Branch prefix for all task branch names: ${branchPrefix}\n\n${context}\n\nGoal: ${goal}`;

  logger.info(`[decomposer] Starting decomposition for: ${goal.slice(0, 100)}`);

  const queryFn = await getQuery();
  const abortController = new AbortController();

  // Abort after 120 seconds
  const abortTimer = setTimeout(() => {
    logger.warn('[decomposer] Aborting — 120s timeout reached');
    abortController.abort();
  }, 120_000);

  let structured: { tasks: RawTask[] } | null = null;

  try {
    const q = queryFn({
      prompt,
      options: {
        cwd: repoPath,
        abortController,
        permissionMode: 'plan',
        model: 'sonnet',
        systemPrompt: DECOMPOSE_SYSTEM_PROMPT,
        outputFormat: { type: 'json_schema', schema: DECOMPOSE_SCHEMA },
      },
    });

    for await (const message of q) {
      logger.debug(`[decomposer] message type=${message.type}`);
      if (message.type === 'result' && !message.is_error) {
        // structured_output is the parsed JSON when outputFormat is used
        const so = (message as any).structured_output;
        if (so) {
          structured = so as { tasks: RawTask[] };
        } else {
          // Fallback: try parsing the result text
          const resultText = (message as any).result || '';
          if (resultText) {
            let jsonStr = resultText;
            const fenceMatch = resultText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
            if (fenceMatch) jsonStr = fenceMatch[1];
            const parsed = JSON.parse(jsonStr.trim());
            structured = Array.isArray(parsed) ? { tasks: parsed } : parsed;
          }
        }
      } else if (message.type === 'result' && message.is_error) {
        const errors = (message as any).errors || [];
        throw new Error(`Decomposition failed: ${errors.join(', ') || 'unknown error'}`);
      }
    }
  } finally {
    clearTimeout(abortTimer);
  }

  if (!structured || !structured.tasks) {
    throw new Error('Decomposition returned no structured output');
  }

  logger.info(`[decomposer] Decomposed into ${structured.tasks.length} raw tasks`);

  const tasks = validateTasks(structured.tasks, branchPrefix);
  logger.info(`[decomposer] Validated ${tasks.length} tasks`);
  return tasks;
}
