import { describe, it, expect } from 'vitest';
import { formatMcpActionError, stripIpcErrorPrefix, mcpNeedsAuthHint } from './mcp-errors.js';

describe('stripIpcErrorPrefix', () => {
  it('removes the Electron remote-method wrapper', () => {
    expect(
      stripIpcErrorPrefix("Error invoking remote method 'agent:mcpReconnect': Error: Server status: needs-auth"),
    ).toBe('Server status: needs-auth');
  });

  it('leaves plain messages alone', () => {
    expect(stripIpcErrorPrefix('boom')).toBe('boom');
  });
});

describe('formatMcpActionError', () => {
  it('explains a needs-auth refusal instead of echoing the raw status', () => {
    const err = new Error("Error invoking remote method 'agent:mcpReconnect': Error: Server status: needs-auth");
    const msg = formatMcpActionError(err, 'reconnect', 'github');
    expect(msg).toBe(mcpNeedsAuthHint('github'));
    expect(msg).toContain('github');
    expect(msg).toContain('Sign in');
    expect(msg).not.toContain('invoking remote method');
  });

  it('explains disabled and pending statuses', () => {
    expect(formatMcpActionError(new Error('Server status: disabled'), 'reconnect', 'x')).toMatch(/disabled/);
    expect(formatMcpActionError(new Error('Server status: pending'), 'reconnect', 'x')).toMatch(/still connecting/);
  });

  it('falls back to a generic message for unknown statuses', () => {
    expect(formatMcpActionError(new Error('Server status: weird'), 'enable', 'x')).toBe(
      'x could not be enabled (status: weird).',
    );
  });

  it('passes through other errors with the IPC prefix stripped', () => {
    const err = new Error("Error invoking remote method 'agent:mcpToggle': Error: MCP server control is not available for this session");
    expect(formatMcpActionError(err, 'disable', 'x')).toBe('MCP server control is not available for this session');
  });

  it('handles non-Error and empty throws', () => {
    expect(formatMcpActionError('nope', 'reconnect', 'x')).toBe('nope');
    expect(formatMcpActionError(undefined, 'reconnect', 'x')).toBe('Failed to reconnect x');
  });
});
