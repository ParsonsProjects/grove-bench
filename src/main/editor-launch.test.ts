import { describe, it, expect, vi, beforeEach } from 'vitest';

// The editor CLI starts in the process host (runProcess), never here.
const mockRun = vi.hoisted(() => vi.fn());
vi.mock('./process-host.js', () => ({ runProcess: mockRun }));
vi.mock('execa', () => ({ execa: vi.fn() }));

import { execa } from 'execa';
import { editorArgs, launchEditor } from './editor-launch.js';

beforeEach(() => {
  mockRun.mockReset();
  vi.mocked(execa).mockReset();
});

describe('editorArgs', () => {
  it('passes just the file when no line is given', () => {
    expect(editorArgs('/repo/src/a.ts', undefined)).toEqual(['/repo/src/a.ts']);
  });

  it('passes -g file:line when a line is given', () => {
    expect(editorArgs('/repo/src/a.ts', 42)).toEqual(['-g', '/repo/src/a.ts:42']);
  });

  it('ignores a line that is not a positive integer', () => {
    // `line` comes over IPC unchecked.
    expect(editorArgs('/repo/a.ts', '1&calc')).toEqual(['/repo/a.ts']);
    expect(editorArgs('/repo/a.ts', 0)).toEqual(['/repo/a.ts']);
    expect(editorArgs('/repo/a.ts', 2.5)).toEqual(['/repo/a.ts']);
  });
});

describe('launchEditor', () => {
  it('runs the editor CLI through execa (in the host) with the path as one argument', async () => {
    mockRun.mockResolvedValue({ stdout: '', stderr: '', failed: false, timedOut: false });
    const file = 'C:\\wt\\src\\x&calc';

    await expect(launchEditor('code', file, 7)).resolves.toBe(true);

    // execa (cross-spawn) resolves the Windows .cmd shim and escapes cmd.exe
    // metacharacters; we must not route through `cmd /c` ourselves.
    expect(mockRun).toHaveBeenCalledWith('code', ['-g', `${file}:7`]);
  });

  it('starts the CLI in the process host, not in the main process', async () => {
    mockRun.mockResolvedValue({ stdout: '', stderr: '', failed: false, timedOut: false });
    await launchEditor('cursor', '/repo/a.ts', undefined);
    expect(mockRun).toHaveBeenCalledOnce();
    expect(execa).not.toHaveBeenCalled();
  });

  it('resolves false when the CLI is missing or fails', async () => {
    mockRun.mockRejectedValue(Object.assign(new Error('spawn code ENOENT'), { code: 'ENOENT' }));
    await expect(launchEditor('cursor', '/repo/a.ts', undefined)).resolves.toBe(false);
  });
});
