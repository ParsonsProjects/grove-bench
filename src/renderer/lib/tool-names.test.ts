import { describe, it, expect } from 'vitest';
import { approvalRequest, parseMcpToolName, toolLabel } from './tool-names.js';

describe('toolLabel', () => {
  it('shows an MCP tool as its name and server', () => {
    expect(toolLabel('mcp__linear__create_issue')).toBe('create issue (linear)');
  });

  it('leaves built-in tools and odd names as they are', () => {
    expect(toolLabel('Bash')).toBe('Bash');
    expect(toolLabel('mcp__broken')).toBe('mcp__broken');
    expect(parseMcpToolName('mcp__server__')).toBeNull();
  });
});

describe('approvalRequest', () => {
  it('says what the agent wants to do', () => {
    expect(approvalRequest('ExitPlanMode')).toBe('has a plan for you to approve');
    expect(approvalRequest('Write')).toBe('wants to edit a file');
    expect(approvalRequest('NotebookEdit')).toBe('wants to edit a file');
    expect(approvalRequest('Bash')).toBe('wants to run a command');
    expect(approvalRequest('WebFetch')).toBe('wants to fetch a web page');
    expect(approvalRequest('mcp__slack__send_message')).toBe('wants to use send message (slack)');
    expect(approvalRequest('Glob')).toBe('wants to use Glob');
  });
});
