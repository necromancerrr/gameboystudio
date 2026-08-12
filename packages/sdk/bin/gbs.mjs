#!/usr/bin/env node
/**
 * gbs — the command a creator runs.
 *
 *   gbs check <dir>     is this bundle well-formed?
 *   gbs dev <dir>       build on change and play it
 *   gbs create <dir>    start from a game that already runs
 *
 * `check` answers whether the platform will accept a bundle. It checks the
 * contract and nothing else (D-022): the handshake, the protocol version,
 * declared resolution, that input arrives and is decoded correctly, that
 * lifecycle verbs behave, that declared capabilities are true, and that the
 * sandbox holds. It never judges whether a game is good, and it deliberately
 * does not require that input produce any particular visible effect — that
 * would fail a turn-based or text game for no reason.
 */
import { runCheck } from '../dist/cli/check.js';
import { runDev } from '../dist/cli/dev.js';
import { runCreate } from '../dist/cli/create.js';

const [command, ...rest] = process.argv.slice(2);

const usage = () => {
  console.log(`
gbs — build a game GameBoyStudio can host

  gbs create <dir>          start from a game that already runs
  gbs dev <dir>             build on change and play it in a preview host
  gbs check <dir>           is this bundle well-formed?

Options:
  --port <n>                dev server port (default 8790)
  --chrome <path>           browser for check (or set CHROME_PATH)
`);
};

try {
  switch (command) {
    case 'check':
      process.exitCode = (await runCheck(rest)) ? 0 : 1;
      break;
    case 'dev':
      await runDev(rest);
      break;
    case 'create':
      await runCreate(rest);
      break;
    default:
      usage();
      process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
