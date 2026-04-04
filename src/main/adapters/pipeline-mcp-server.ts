/**
 * Grove Pipeline Tasks MCP Server — exposes task DB operations as SDK MCP tools.
 * Agents can read/write tasks in the pipeline's NeDB database via these tools.
 * Follows the same pattern as memory-mcp-server.ts.
 */
import type { PipelineDb } from '../pipeline-db.js';
import type { PipelineRoleId, TaskStatus } from '../../shared/types.js';

// ─── SDK dynamic import (ESM-only module in a CJS Electron main process) ───

const dynamicImport = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<typeof import('@anthropic-ai/claude-agent-sdk')>;

let _createSdkMcpServer: typeof import('@anthropic-ai/claude-agent-sdk').createSdkMcpServer;
let _tool: typeof import('@anthropic-ai/claude-agent-sdk').tool;

async function ensureSdk() {
  if (!_createSdkMcpServer) {
    const sdk = await dynamicImport('@anthropic-ai/claude-agent-sdk');
    _createSdkMcpServer = sdk.createSdkMcpServer;
    _tool = sdk.tool;
  }
}

/** Tool names as they appear to the agent after MCP registration. */
export const GROVE_PIPELINE_TOOL_NAMES = [
  'mcp__grove-tasks__task_list',
  'mcp__grove-tasks__task_read',
  'mcp__grove-tasks__task_update',
  'mcp__grove-tasks__task_create',
] as const;

const VALID_TASK_STATUSES: TaskStatus[] = [
  'new', 'planned', 'in-progress', 'implemented', 'qa-passed', 'completed', 'failed',
];

const VALID_ROLES: PipelineRoleId[] = ['planner', 'engineer', 'qa', 'reviewer'];

export async function createPipelineTaskMcpServer(db: PipelineDb, pipelineId: string) {
  await ensureSdk();

  const { z } = await import('zod/v4');

  return _createSdkMcpServer({
    name: 'grove-tasks',
    tools: [
      _tool('task_list', 'List all tasks for the current pipeline', {}, async () => {
        const tasks = await db.listTasksForPipeline(pipelineId);
        return { content: [{ type: 'text' as const, text: JSON.stringify(tasks, null, 2) }] };
      }, { annotations: { readOnly: true } }),

      _tool('task_read', 'Read a specific task by ID', {
        id: z.string().describe('The task _id to read'),
      }, async ({ id }) => {
        const task = await db.getTask(id);
        if (!task) {
          return { content: [{ type: 'text' as const, text: `Task not found: ${id}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] };
      }, { annotations: { readOnly: true } }),

      _tool('task_update', 'Update a task (status, body, branch, labels)', {
        id: z.string().describe('The task _id to update'),
        status: z.enum(VALID_TASK_STATUSES as [string, ...string[]]).optional().describe('New task status'),
        body: z.string().optional().describe('Updated task body (markdown). Append to existing body rather than replacing.'),
        branch: z.string().optional().describe('Git branch name associated with this task'),
        labels: z.array(z.string()).optional().describe('Task labels'),
      }, async ({ id, ...fields }) => {
        const task = await db.getTask(id);
        if (!task) {
          return { content: [{ type: 'text' as const, text: `Task not found: ${id}` }], isError: true };
        }

        const update: Record<string, unknown> = {};
        if (fields.status !== undefined) update.status = fields.status;
        if (fields.body !== undefined) update.body = fields.body;
        if (fields.branch !== undefined) update.branch = fields.branch;
        if (fields.labels !== undefined) update.labels = fields.labels;

        if (Object.keys(update).length === 0) {
          return { content: [{ type: 'text' as const, text: 'No fields to update' }], isError: true };
        }

        await db.updateTask(id, update);
        return { content: [{ type: 'text' as const, text: `Updated task ${id}` }] };
      }, { annotations: { destructive: false } }),

      _tool('task_create', 'Create a new task in the pipeline', {
        title: z.string().describe('Task title'),
        body: z.string().describe('Task body in markdown'),
        assignedRole: z.enum(VALID_ROLES as [string, ...string[]]).describe('Role to assign the task to'),
        priority: z.number().min(0).max(4).optional().describe('Priority (0=highest, 4=lowest). Default: 2'),
        labels: z.array(z.string()).optional().describe('Task labels'),
      }, async ({ title, body, assignedRole, priority, labels }) => {
        const now = new Date().toISOString();
        const task = await db.createTask({
          pipelineId,
          title,
          body,
          status: 'new',
          assignedRole: assignedRole as PipelineRoleId,
          priority: priority ?? 2,
          branch: null,
          labels: labels ?? [],
          createdAt: now,
          updatedAt: now,
        });
        return { content: [{ type: 'text' as const, text: `Created task ${task._id}: ${title}` }] };
      }, { annotations: { destructive: false } }),
    ],
  });
}
