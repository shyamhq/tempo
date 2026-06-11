import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ConnectToken } from '@tempo/contracts';
import { env } from './env';
import { ConsoleClient } from './http-client';
import { logger } from './logger';
import { runStreamPump } from './stream-pump';

const execAsync = promisify(exec);

export async function connect(token: ConnectToken): Promise<void> {
  process.stdout.write(`connecting to ${env.TEMPO_CONSOLE_URL}...\n`);

  const client = new ConsoleClient(env.TEMPO_CONSOLE_URL, token);
  const repo = await collectRepoMetadata();

  const session = await client.createSession(repo);
  // Don't log the handshake response — `agent_api_key` is workspace-wide
  // and never belongs in logs.
  logger.debug({ session_id: session.session_id, thread_id: session.thread_id }, 'session created');
  process.stdout.write(
    `attached to thread ${session.thread_id} as session ${session.session_id}\n`,
  );
  process.stdout.write('launching claude...\n\n');

  const exitCode = await runStreamPump({
    sessionId: session.session_id,
    threadId: session.thread_id,
    agentApiKey: session.agent_api_key,
  });
  process.exit(exitCode);
}

async function collectRepoMetadata(): Promise<{
  repo_remote: string | null;
  repo_path: string;
}> {
  const repo_path = process.cwd();
  let repo_remote: string | null = null;
  try {
    const { stdout } = await execAsync('git config --get remote.origin.url', { timeout: 2000 });
    const url = stdout.trim();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      repo_remote = url;
    }
  } catch {
    // Not a git repo, no remote, or git not installed — display-only field.
  }
  return { repo_remote, repo_path };
}
