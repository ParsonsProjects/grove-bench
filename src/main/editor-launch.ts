export interface EditorLaunch {
  cmd: string;
  args: string[];
}

/**
 * Build the command + args to open a file in an editor CLI (code / cursor),
 * platform-aware.
 *
 * On Windows the VS Code and Cursor CLIs are `.cmd` shims: there is no bare
 * `code.exe` on PATH, and Node's execFile/spawn don't apply PATHEXT to find
 * `.cmd` files (and refuse to run them directly). Left unhandled, the launch
 * fails and the caller falls back to the OS default opener — which on Windows
 * opens `.ts` source files in a media player (`.ts` is also a video container
 * extension). So on Windows we go through `cmd.exe /c <editor> …`, which
 * resolves the shim via PATHEXT. The path stays a separate argv entry, so Node
 * quotes it (handling spaces) and there's no shell-injection surface.
 */
export function editorLaunchCommand(
  editor: string,
  resolvedPath: string,
  line: number | undefined,
  platform: NodeJS.Platform = process.platform,
): EditorLaunch {
  const gotoArgs = line ? ['-g', `${resolvedPath}:${line}`] : [resolvedPath];
  if (platform === 'win32') {
    return { cmd: process.env.COMSPEC || 'cmd.exe', args: ['/c', editor, ...gotoArgs] };
  }
  return { cmd: editor, args: gotoArgs };
}
