#!/usr/bin/env node
import { connectCommand } from './commands/connect';
import { initCommand } from './commands/init';

const [, , subcommand, ...rest] = process.argv;

switch (subcommand) {
  case 'init':
    initCommand().catch((err) => {
      process.stderr.write(
        `tempo init failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    });
    break;

  case 'connect':
    connectCommand(rest[0]).catch((err) => {
      process.stderr.write(
        `tempo connect failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    });
    break;

  default:
    process.stderr.write(
      `unknown subcommand "${subcommand ?? ''}"\n` +
        `usage: tempo-agent init\n` +
        `       tempo-agent connect <thread-id>\n`,
    );
    process.exit(2);
}
