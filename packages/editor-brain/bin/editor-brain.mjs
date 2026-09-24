#!/usr/bin/env node
// Thin wrapper around runBrainCli (see src/cli.ts). Requires `npm run build`.
import { readFileSync } from 'node:fs';
import { runBrainCli } from '../dist/index.js';

process.exitCode = await runBrainCli(process.argv.slice(2), {
  readInput: (p) => readFileSync(p === '-' ? 0 : p, 'utf8'),
  stdout: (t) => process.stdout.write(`${t}\n`),
  stderr: (t) => process.stderr.write(`${t}\n`),
});
