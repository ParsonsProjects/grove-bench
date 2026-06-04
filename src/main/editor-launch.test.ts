import { describe, it, expect } from 'vitest';
import { editorLaunchCommand } from './editor-launch.js';

describe('editorLaunchCommand', () => {
  it('on non-Windows invokes the editor CLI directly', () => {
    const { cmd, args } = editorLaunchCommand('code', '/repo/src/a.ts', undefined, 'darwin');
    expect(cmd).toBe('code');
    expect(args).toEqual(['/repo/src/a.ts']);
  });

  it('on non-Windows passes -g file:line when a line is given', () => {
    const { cmd, args } = editorLaunchCommand('cursor', '/repo/src/a.ts', 42, 'linux');
    expect(cmd).toBe('cursor');
    expect(args).toEqual(['-g', '/repo/src/a.ts:42']);
  });

  it('on Windows runs through cmd.exe so PATHEXT resolves the .cmd shim', () => {
    const { cmd, args } = editorLaunchCommand('code', 'C:\\repo\\src\\a.ts', undefined, 'win32');
    expect(cmd).toBe(process.env.COMSPEC || 'cmd.exe');
    // The editor and path are separate argv entries — Node quotes the path arg,
    // avoiding both the .ts→media-player association and shell injection.
    expect(args).toEqual(['/c', 'code', 'C:\\repo\\src\\a.ts']);
  });

  it('on Windows includes -g file:line when a line is given', () => {
    const { args } = editorLaunchCommand('code', 'C:\\repo\\a.ts', 7, 'win32');
    expect(args).toEqual(['/c', 'code', '-g', 'C:\\repo\\a.ts:7']);
  });
});
