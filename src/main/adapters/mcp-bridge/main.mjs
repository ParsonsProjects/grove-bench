// Entry point of the MCP stdio bridge (see bridge.mjs). Vite bundles this to
// dist/main/mcp-stdio-bridge.js; tests run it from the source tree.
import { main } from './bridge.mjs';

/** Exit once stdout has taken the last reply: a pipe may still be writing. */
function exit(code) {
  process.stdout.write('', () => process.exit(code));
}

main().then(exit, (err) => {
  process.stderr.write(`Grove Bench MCP bridge failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  exit(1);
});
