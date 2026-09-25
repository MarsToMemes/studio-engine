#!/usr/bin/env node
// Thin wrapper around runRenderCli (see src/cli.ts). Requires `npm run build`.
import { runRenderCli } from '../dist/index.js';

process.exitCode = await runRenderCli(process.argv.slice(2), {
  stdout: (t) => process.stdout.write(`${t}\n`),
  stderr: (t) => process.stderr.write(`${t}\n`),
});
