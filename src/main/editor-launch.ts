import { execa } from 'execa';

/** Args for a VS Code-style CLI (code / cursor): the file, or `-g file:line`. */
export function editorArgs(resolvedPath: string, line: unknown): string[] {
  return Number.isInteger(line) && (line as number) > 0
    ? ['-g', `${resolvedPath}:${line}`]
    : [resolvedPath];
}

/**
 * Open a file in an editor CLI. Resolves false if the CLI isn't installed or
 * fails, so the caller can try the next one.
 *
 * On Windows the VS Code and Cursor CLIs are `.cmd` shims: Node's execFile
 * won't find them (no PATHEXT lookup) and they have to run through cmd.exe.
 * cmd.exe ignores Node's argument quoting, so passing the path as a plain
 * argv entry to `cmd /c` lets a file name like `x&calc` run `calc`. execa
 * (through cross-spawn) resolves the shim via PATHEXT and escapes every
 * cmd.exe metacharacter, so the path reaches the editor as one argument.
 */
export async function launchEditor(editor: string, resolvedPath: string, line: unknown): Promise<boolean> {
  try {
    await execa(editor, editorArgs(resolvedPath, line));
    return true;
  } catch {
    return false;
  }
}
