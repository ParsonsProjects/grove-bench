/**
 * Grove's own tools for the agent, defined once for every way they reach it:
 * the Claude Code adapter registers them as in-process SDK MCP servers
 * (memory-mcp-server.ts, preview-mcp-server.ts), and agents that can only
 * connect to MCP servers by address get them from grove-mcp-http.ts.
 *
 * Two servers: `grove-memory` (project memory, MemoryOperations) and
 * `grove-preview` (the conversation's Preview browser, PreviewOperations).
 */
import { z } from 'zod';
import type { MemoryOperations, PreviewOperations } from './types.js';

export type GroveServerName = 'grove-memory' | 'grove-preview';

export type GroveToolResult = {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
};

export interface GroveToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
}

/** One tool: what the agent sees (name, description, input shape) and what
 *  runs. `args` has been validated against `shape` by the MCP layer. */
export interface GroveTool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  run: (args: any) => Promise<GroveToolResult>;
  annotations: GroveToolAnnotations;
  /** Words for Claude Code's tool search. */
  searchHint?: string;
}

export interface GroveServer {
  name: GroveServerName;
  /** Told to the agent when it connects. */
  instructions?: string;
  /** Load the tools up front rather than behind the agent's tool search. */
  alwaysLoad?: boolean;
  tools: GroveTool[];
}

function text(value: string): GroveToolResult {
  return { content: [{ type: 'text', text: value }] };
}

/** Run a tool body, turning a thrown error into a tool error the agent reads. */
async function guarded(fn: () => Promise<GroveToolResult>): Promise<GroveToolResult> {
  try {
    return await fn();
  } catch (e) {
    return { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
}

/** Exactly one of the given fields must be set. */
function pickOne(fields: Record<string, string | undefined>): string | null {
  const set = Object.entries(fields).filter(([, v]) => typeof v === 'string' && v.trim() !== '');
  if (set.length === 1) return null;
  const names = Object.keys(fields).join(', ');
  return set.length === 0 ? `Give one of: ${names}.` : `Give only one of: ${names}.`;
}

// ─── grove-memory ───

export function memoryServer(ops: MemoryOperations): GroveServer {
  return {
    name: 'grove-memory',
    tools: [
      {
        name: 'memory_list',
        description: 'List all memory files for this project',
        shape: {},
        run: async () => text(JSON.stringify(ops.list(), null, 2)),
        annotations: { readOnlyHint: true },
      },
      {
        name: 'memory_read',
        description: 'Read a memory file by relative path',
        shape: {
          path: z.string().describe('Relative path within the memory directory, e.g. "repo/overview.md"'),
        },
        run: async ({ path }: { path: string }) => {
          const content = ops.read(path);
          if (content === null) {
            return { content: [{ type: 'text', text: `File not found: ${path}` }], isError: true };
          }
          return text(content);
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'memory_write',
        description: 'Write or update a memory file',
        shape: {
          path: z.string().describe('Relative path (must end in .md), e.g. "sessions/current-plan.md"'),
          content: z.string().describe('Full file content including YAML frontmatter'),
        },
        run: async ({ path, content }: { path: string; content: string }) => {
          ops.write(path, content);
          return text(`Written: ${path}`);
        },
        annotations: { destructiveHint: false },
      },
      {
        name: 'memory_delete',
        description: 'Delete a memory file',
        shape: {
          path: z.string().describe('Relative path of the file to delete'),
        },
        run: async ({ path }: { path: string }) => {
          const deleted = ops.delete(path);
          return {
            content: [{ type: 'text', text: deleted ? `Deleted: ${path}` : `Not found: ${path}` }],
            isError: !deleted,
          };
        },
        annotations: { destructiveHint: true },
      },
    ],
  };
}

// ─── grove-preview ───

/** Tool bodies, separate from the tool definitions so they can be tested alone. */
export function previewToolHandlers(ops: PreviewOperations) {
  return {
    open: ({ url, width, height }: { url?: string; width?: number; height?: number }) =>
      guarded(async () => text(await ops.open({ url, width, height }))),

    screenshot: () => guarded(async () => {
      const shot = await ops.screenshot();
      return {
        content: [
          { type: 'text', text: `Screenshot of ${shot.url} (${shot.width}×${shot.height})` },
          { type: 'image', data: shot.data.toString('base64'), mimeType: shot.mimeType },
        ],
      };
    }),

    read: ({ selector, maxChars }: { selector?: string; maxChars?: number }) =>
      guarded(async () => text(await ops.read({ selector, maxChars }))),

    logs: ({ errorsOnly, all }: { errorsOnly?: boolean; all?: boolean }) =>
      guarded(async () => text(await ops.logs({ errorsOnly, all }))),

    click: ({ selector, text: label, dialogs }: { selector?: string; text?: string; dialogs?: 'accept' | 'dismiss' }) => guarded(async () => {
      const problem = pickOne({ selector, text: label });
      if (problem) throw new Error(problem);
      return text(await ops.click({ selector, text: label }, { dialogs }));
    }),

    type: ({ selector, label, text: value, clear, submit, dialogs }: { selector?: string; label?: string; text: string; clear?: boolean; submit?: boolean; dialogs?: 'accept' | 'dismiss' }) =>
      guarded(async () => {
        const problem = pickOne({ selector, label });
        if (problem) throw new Error(problem);
        return text(await ops.type({ selector, label }, value, { clear, submit, dialogs }));
      }),
  };
}

export function previewServer(ops: PreviewOperations): GroveServer {
  const run = previewToolHandlers(ops);
  return {
    name: 'grove-preview',
    instructions: 'A browser for checking web UI work. It opens local pages only, in this conversation\'s Preview tab in '
      + 'Grove Bench, where the user can watch. After changing a web UI, start its dev server, open the URL with '
      + 'preview_open, then check it with preview_screenshot, preview_read and preview_logs, and try flows with '
      + 'preview_click and preview_type. For local pages, use these tools rather than other browser tools you may have '
      + '(such as a Playwright or Chrome DevTools MCP server): those open a separate browser window outside Grove Bench.',
    // Load the tools up front rather than behind tool search, so the agent
    // sees them next to any other browser tools the user has set up (a
    // Playwright MCP server, say) and doesn't reach for those first.
    alwaysLoad: true,
    tools: [
      {
        name: 'preview_open',
        description: 'Open a page in your browser in this conversation\'s Preview tab in Grove Bench, to check UI work in the running app. '
          + 'The user can watch it there. Use this, not other browser tools (such as Playwright\'s browser_navigate), for local pages: '
          + 'those open a separate browser window outside Grove Bench. '
          + 'Start the dev server first (for example as a background Bash command), then open its URL '
          + 'and use preview_screenshot, preview_read, preview_click, preview_type and preview_logs. '
          + 'Only local pages open: localhost, 127.0.0.1, [::1], or .html files inside this worktree. '
          + 'A path like "/settings" opens on the current page\'s server. Call with no url to reload. '
          + 'The viewport is 1280×800 unless you set width and height (for example 390×844 for a phone).',
        shape: {
          url: z.string().optional().describe('URL to open, e.g. "http://localhost:5173/" or "localhost:3000/login". Omit to reload the current page.'),
          width: z.number().int().min(320).max(2560).optional().describe('Viewport width in CSS pixels.'),
          height: z.number().int().min(240).max(1600).optional().describe('Viewport height in CSS pixels.'),
        },
        run: run.open,
        searchHint: 'open navigate local web page dev server url in browser preview',
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      {
        name: 'preview_screenshot',
        description: 'Take a screenshot of the page open in your Preview browser (see preview_open). Shows the viewport, not the whole scrollable page.',
        shape: {},
        run: run.screenshot,
        searchHint: 'screenshot browser preview page ui',
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      {
        name: 'preview_read',
        description: 'Read the visible text of the page open in your Preview browser, plus a list of its links, buttons and form fields '
          + 'with their labels and current values. Cheaper than a screenshot for checking content or finding what to click. '
          + 'Pass a CSS selector to read one part of the page.',
        shape: {
          selector: z.string().optional().describe('CSS selector of the element to read. Omit for the whole page.'),
          maxChars: z.number().int().min(500).max(100000).optional().describe('Maximum characters of text to return (default 20000).'),
        },
        run: run.read,
        searchHint: 'read text of browser preview page',
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      {
        name: 'preview_logs',
        description: 'Console messages, uncaught errors and failed network requests (4xx/5xx responses and connection errors) '
          + 'from the page open in your Preview browser, since you last called this tool.',
        shape: {
          errorsOnly: z.boolean().optional().describe('Only return errors.'),
          all: z.boolean().optional().describe('Return everything kept (the last 300 entries), not just what is new.'),
        },
        run: run.logs,
        searchHint: 'browser console errors network failures',
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      {
        name: 'preview_click',
        description: 'Click an element in the page open in your Preview browser with a real mouse click. Target it with a CSS selector, '
          + 'or with the visible text of a button, link or other clickable element (exact match preferred, then partial). '
          + 'Fails if the element is hidden or covered by something else. Returns the page URL afterwards and any new errors. '
          + 'An alert or confirm dialog it opens is answered OK unless dialogs is "dismiss"; the result says what it showed.',
        shape: {
          selector: z.string().optional().describe('CSS selector of the element.'),
          text: z.string().optional().describe('Visible text of the element, e.g. "Save".'),
          dialogs: z.enum(['accept', 'dismiss']).optional().describe('How to answer an alert or confirm the click opens: accept (OK, default) or dismiss (Cancel).'),
        },
        run: run.click,
        searchHint: 'click button link in browser preview',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      {
        name: 'preview_type',
        description: 'Type into a form field in the page open in your Preview browser: an input, textarea or editable element, '
          + 'or choose an option in a <select> by its text. Target the field with a CSS selector, or with its label, '
          + 'placeholder, aria-label or name. Replaces the current value unless clear is false.',
        shape: {
          selector: z.string().optional().describe('CSS selector of the field.'),
          label: z.string().optional().describe('Label, placeholder, aria-label or name of the field, e.g. "Email".'),
          text: z.string().describe('Text to type, or the option to choose in a <select>. Empty clears the field.'),
          clear: z.boolean().optional().describe('Replace the current value (default true). False appends at the cursor.'),
          submit: z.boolean().optional().describe('Press Enter afterwards, e.g. to submit a form.'),
          dialogs: z.enum(['accept', 'dismiss']).optional().describe('How to answer an alert or confirm this opens: accept (OK, default) or dismiss (Cancel).'),
        },
        run: run.type,
        searchHint: 'type fill form field in browser preview',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
    ],
  };
}
