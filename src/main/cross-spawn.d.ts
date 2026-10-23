/** The part of cross-spawn Grove uses (process-host-spawn.ts): its parse
 *  step, which execa runs before it spawns too. cross-spawn ships no types. */
declare module 'cross-spawn' {
  import type { SpawnOptions } from 'node:child_process';

  interface ParsedCommand {
    command: string;
    args: string[];
    options: SpawnOptions;
    /** The program it found, on Windows only; undefined there when it found
     *  none (cmd.exe then runs the command and says it isn't there). */
    file?: string;
  }

  const crossSpawn: {
    _parse(command: string, args: readonly string[], options: SpawnOptions): ParsedCommand;
  };
  export default crossSpawn;
}
