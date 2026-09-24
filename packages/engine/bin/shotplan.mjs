#!/usr/bin/env node
// Thin wrapper around runShotPlanCli (see src/shotplan/cli.ts). Requires `npm run build`.
import { readFileSync } from 'node:fs';
import { runShotPlanCli } from '../dist/index.js';

process.exitCode = runShotPlanCli(process.argv.slice(2), {
  readInput: (p) => readFileSync(p === '-' ? 0 : p, 'utf8'),
  stdout: (t) => process.stdout.write(`${t}\n`),
  stderr: (t) => process.stderr.write(`${t}\n`),
});
