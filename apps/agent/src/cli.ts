#!/usr/bin/env node
export {};

// --verbose / -v flips TEMPO_LOG_MODE before env is parsed by any imported
// module, so the logger picks up debug level at construction time.
const argv = process.argv.slice(2);
if (argv.includes('--verbose') || argv.includes('-v')) {
  process.env.TEMPO_LOG_MODE = 'verbose';
}
const flags = new Set(['--verbose', '-v']);
const filtered = argv.filter((a) => !flags.has(a));

const { connectCommand } = await import('./commands/connect');
const { initCommand } = await import('./commands/init');

const [subcommand, ...rest] = filtered;

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
