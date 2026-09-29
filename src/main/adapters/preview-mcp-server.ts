/**
 * Grove Preview MCP Server — exposes the conversation's Preview browser to the
 * agent as SDK MCP tools. Claude Code adapter-specific: wraps the generic
 * PreviewOperations interface into an in-process SDK MCP server.
 *
 * The tools drive "Claude's page", separate from the page the user browses,
 * and only open local URLs. The user can watch it in the Preview tab.
 */
import type { PreviewOperations } from './types.js';

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

/** Tools that only look (or load a local page). Run without a prompt. */
export const GROVE_PREVIEW_READ_TOOL_NAMES = [
  'mcp__grove-preview__preview_open',
  'mcp__grove-preview__preview_screenshot',
  'mcp__grove-preview__preview_read',
  'mcp__grove-preview__preview_logs',
] as const;

/** Tools that act on the page. They ask like any other action tool. */
export const GROVE_PREVIEW_ACTION_TOOL_NAMES = [
  'mcp__grove-preview__preview_click',
  'mcp__grove-preview__preview_type',
] as const;

type ToolResult = {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
};

function text(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }] };
}

/** Run a tool body, turning a thrown error into a tool error the agent reads. */
async function guarded(fn: () => Promise<ToolResult>): Promise<ToolResult> {
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

/** Tool bodies, separate from the SDK wiring so they can be tested alone. */
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

export async function createPreviewMcpServer(ops: PreviewOperations) {
  await ensureSdk();

  const { z } = await import('zod/v4');
  const run = previewToolHandlers(ops);

  return _createSdkMcpServer({
    name: 'grove-preview',
    instructions: 'A browser for checking web UI work. It opens local pages only, in this conversation\'s Preview tab in '
      + 'Grove Bench, where the user can watch. After changing a web UI, start its dev server, open the URL with '
      + 'preview_open, then check it with preview_screenshot, preview_read and preview_logs, and try flows with '
      + 'preview_click and preview_type.',
    tools: [
      _tool(
        'preview_open',
        'Open a page in your browser in this conversation\'s Preview tab in Grove Bench, to check UI work in the running app. '
        + 'The user can watch it there. Start the dev server first (for example as a background Bash command), then open its URL '
        + 'and use preview_screenshot, preview_read, preview_click, preview_type and preview_logs. '
        + 'Only local pages open: localhost, 127.0.0.1, [::1], or .html files inside this worktree. '
        + 'A path like "/settings" opens on the current page\'s server. Call with no url to reload. '
        + 'The viewport is 1280×800 unless you set width and height (for example 390×844 for a phone).',
        {
          url: z.string().optional().describe('URL to open, e.g. "http://localhost:5173/" or "localhost:3000/login". Omit to reload the current page.'),
          width: z.number().int().min(320).max(2560).optional().describe('Viewport width in CSS pixels.'),
          height: z.number().int().min(240).max(1600).optional().describe('Viewport height in CSS pixels.'),
        },
        run.open,
        { searchHint: 'open local web page dev server url in browser preview', annotations: { readOnlyHint: true, openWorldHint: false } },
      ),

      _tool(
        'preview_screenshot',
        'Take a screenshot of the page open in your Preview browser (see preview_open). Shows the viewport, not the whole scrollable page.',
        {},
        run.screenshot,
        { searchHint: 'screenshot browser preview page ui', annotations: { readOnlyHint: true, openWorldHint: false } },
      ),

      _tool(
        'preview_read',
        'Read the visible text of the page open in your Preview browser, plus a list of its links, buttons and form fields '
        + 'with their labels and current values. Cheaper than a screenshot for checking content or finding what to click. '
        + 'Pass a CSS selector to read one part of the page.',
        {
          selector: z.string().optional().describe('CSS selector of the element to read. Omit for the whole page.'),
          maxChars: z.number().int().min(500).max(100000).optional().describe('Maximum characters of text to return (default 20000).'),
        },
        run.read,
        { searchHint: 'read text of browser preview page', annotations: { readOnlyHint: true, openWorldHint: false } },
      ),

      _tool(
        'preview_logs',
        'Console messages, uncaught errors and failed network requests (4xx/5xx responses and connection errors) '
        + 'from the page open in your Preview browser, since you last called this tool.',
        {
          errorsOnly: z.boolean().optional().describe('Only return errors.'),
          all: z.boolean().optional().describe('Return everything kept (the last 300 entries), not just what is new.'),
        },
        run.logs,
        { searchHint: 'browser console errors network failures', annotations: { readOnlyHint: true, openWorldHint: false } },
      ),

      _tool(
        'preview_click',
        'Click an element in the page open in your Preview browser with a real mouse click. Target it with a CSS selector, '
        + 'or with the visible text of a button, link or other clickable element (exact match preferred, then partial). '
        + 'Fails if the element is hidden or covered by something else. Returns the page URL afterwards and any new errors. '
        + 'An alert or confirm dialog it opens is answered OK unless dialogs is "dismiss"; the result says what it showed.',
        {
          selector: z.string().optional().describe('CSS selector of the element.'),
          text: z.string().optional().describe('Visible text of the element, e.g. "Save".'),
          dialogs: z.enum(['accept', 'dismiss']).optional().describe('How to answer an alert or confirm the click opens: accept (OK, default) or dismiss (Cancel).'),
        },
        run.click,
        { searchHint: 'click button link in browser preview', annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
      ),

      _tool(
        'preview_type',
        'Type into a form field in the page open in your Preview browser: an input, textarea or editable element, '
        + 'or choose an option in a <select> by its text. Target the field with a CSS selector, or with its label, '
        + 'placeholder, aria-label or name. Replaces the current value unless clear is false.',
        {
          selector: z.string().optional().describe('CSS selector of the field.'),
          label: z.string().optional().describe('Label, placeholder, aria-label or name of the field, e.g. "Email".'),
          text: z.string().describe('Text to type, or the option to choose in a <select>. Empty clears the field.'),
          clear: z.boolean().optional().describe('Replace the current value (default true). False appends at the cursor.'),
          submit: z.boolean().optional().describe('Press Enter afterwards, e.g. to submit a form.'),
          dialogs: z.enum(['accept', 'dismiss']).optional().describe('How to answer an alert or confirm this opens: accept (OK, default) or dismiss (Cancel).'),
        },
        run.type,
        { searchHint: 'type fill form field in browser preview', annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
      ),
    ],
  });
}
