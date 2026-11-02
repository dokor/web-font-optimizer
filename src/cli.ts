#!/usr/bin/env node
import { scan } from './scan.js';
import { runCli } from './reporters/index.js';

process.exitCode = await runCli(process.argv.slice(2), {
  async audit(target) {
    // The foundation registry is empty. #8 will connect the production analyzers
    // and #6's engine here; reporters do not construct diagnostics or resources.
    const { observations } = await scan(target);
    return { version: 1, inventory: { observations, resources: [] }, diagnostics: [] };
  },
  stdout: text => { process.stdout.write(text); },
  stderr: text => { process.stderr.write(text); },
});
