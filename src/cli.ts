#!/usr/bin/env node
import { audit } from './audit.js';
import { runCli } from './reporters/index.js';

process.exitCode = await runCli(process.argv.slice(2), {
  audit,
  stdout: text => { process.stdout.write(text); },
  stderr: text => { process.stderr.write(text); },
});
