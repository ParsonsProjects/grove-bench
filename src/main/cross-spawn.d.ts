/** The part of cross-spawn Grove uses (process-host-spawn.ts): its parse
 *  step, which execa runs before it spawns too. cross-spawn ships no types. */
declare module 'cross-spawn' {
  import type { SpawnOptions } from 'node:child_process';

  interface ParsedCommand {
    command: string;
    args: string[];
    options: SpawnOptions;
  }

  const crossSpawn: {
    _parse(command: string, args: readonly string[], options: SpawnOptions): ParsedCommand;
  };
  export default crossSpawn;
}
