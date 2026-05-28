#!/usr/bin/env node
import { ConnectToken } from '@tempo/contracts';
import { connect } from './connect';
import { toDevMessage } from './errors';
import { logger } from './logger';

async function main(): Promise<void> {
  const [, , command, token, ...rest] = process.argv;
  if (command !== 'connect' || !token || rest.length > 0) {
    process.stderr.write('usage: tempo-agent connect <token>\n');
    process.exit(2);
  }

  const parsed = ConnectToken.safeParse(token);
  if (!parsed.success) {
    process.stderr.write('failed: token must look like tmp_<32+ chars>\n');
    process.exit(2);
  }

  await connect(parsed.data);
}

main().catch((err) => {
  logger.debug({ err }, 'fatal');
  process.stderr.write(`${toDevMessage(err)}\n`);
  process.exit(1);
});
