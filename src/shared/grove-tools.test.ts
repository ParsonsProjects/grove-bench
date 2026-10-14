import { describe, it, expect } from 'vitest';
import { GROVE_TOOL_NAMES, titledAsGroveTool } from './grove-tools.js';
import { memoryServer, previewServer } from '../main/adapters/grove-tools.js';

describe('GROVE_TOOL_NAMES', () => {
  it("lists the tools Grove's servers define", () => {
    const ops = {} as never;
    for (const server of [memoryServer(ops), previewServer(ops)]) {
      expect([...GROVE_TOOL_NAMES[server.name]].sort(), server.name).toEqual(server.tools.map((t) => t.name).sort());
    }
  });
});

describe('titledAsGroveTool', () => {
  it("reads Gemini CLI's titles for Grove's tools, with and without arguments", () => {
    expect(titledAsGroveTool('memory_read(path: "a.md")')).toBe(true);
    expect(titledAsGroveTool('memory_list (grove-memory MCP Server)')).toBe(true);
    expect(titledAsGroveTool('grove-preview_preview_open')).toBe(true);
    expect(titledAsGroveTool('preview_screenshot')).toBe(true);
  });

  it("doesn't read other tools as Grove's", () => {
    expect(titledAsGroveTool('create_issue(title: "Bug")')).toBe(false);
    expect(titledAsGroveTool('memory_reader(path: "a")')).toBe(false);
    expect(titledAsGroveTool('list_issues (linear MCP Server)')).toBe(false);
  });
});
