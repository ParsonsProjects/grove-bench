import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { execa } from 'execa';
import { editorArgs, launchEditor } from './editor-launch.js';

const mockExeca = vi.mocked(execa);

beforeEach(() => {
  mockExeca.mockReset();
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
  it('runs the editor CLI through execa with the path as one argument', async () => {
    mockExeca.mockResolvedValue({} as never);
    const file = 'C:\\wt\\src\\x&calc';

    await expect(launchEditor('code', file, 7)).resolves.toBe(true);

    // execa (cross-spawn) resolves the Windows .cmd shim and escapes cmd.exe
    // metacharacters; we must not route through `cmd /c` ourselves.
    expect(mockExeca).toHaveBeenCalledWith('code', ['-g', `${file}:7`]);
  });

  it('resolves false when the CLI is missing or fails', async () => {
    mockExeca.mockRejectedValue(new Error('spawn code ENOENT'));
    await expect(launchEditor('cursor', '/repo/a.ts', undefined)).resolves.toBe(false);
  });
});
