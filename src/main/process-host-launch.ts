/**
 * How a hosted launch's time splits: finding the program, and the OS
 * creating its process. The freeze log saw launches of seconds, up to 50 s
 * (28 Oct to 3 Nov, a PC with AVG), and they hold the host meanwhile; which
 * part is slow says where to look. Finding it is cross-spawn's parse, which
 * execa runs before it spawns, and the agent host runs itself for a
 * `findCommand` spawn (process-host-spawn.ts): on Windows it stats each
 * folder on PATH (the working folder first) for each PATHEXT extension,
 * then opens what it found to read its first bytes for a shebang. The rest
 * is spawn(), which on Windows is CreateProcess, where an antivirus checks
 * the program before it runs. A program given by its full path, with no
 * search, spends next to none of its launch finding it.
 *
 * Loaded by the host (process-host-child.ts), where execa runs.
 */
import crossSpawn from 'cross-spawn';

type Parse = typeof crossSpawn._parse;

/**
 * Time every parse cross-spawn does in this process, execa's included, by
 * wrapping its `_parse` (execa calls it through the module, so it calls the
 * wrapper). What it returns, and what it throws, are unchanged. Returns a
 * function that gives the time the parses since its last call took
 * (undefined if there were none), and starts again from zero.
 */
export function timeFinds(
  target: { _parse: Parse } = crossSpawn,
  now: () => number = () => performance.now(),
): () => number | undefined {
  const parse = target._parse;
  let total: number | undefined;
  target._parse = (command, args, options) => {
    const start = now();
    try {
      return parse.call(target, command, args, options);
    } finally {
      total = (total ?? 0) + (now() - start);
    }
  };
  return () => {
    const ms = total;
    total = undefined;
    return ms;
  };
}
