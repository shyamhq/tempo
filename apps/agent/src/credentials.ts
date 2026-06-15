import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { logger } from './logger';

export type Credentials = {
  version: 1;
  user_id: string;
  email: string;
  worker_url: string;
  token: string; // sk_user_*
  refresh_token: string; // rt_*
  issued_at: string; // ISO
  expires_at: string; // ISO
};

const CREDENTIALS_DIR = join(homedir(), '.tempo');
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, 'credentials.json');

export async function read(): Promise<Credentials> {
  let raw: string;
  try {
    raw = await readFile(CREDENTIALS_PATH, 'utf8');
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`credentials not found (${cause}). Run \`tempo-agent init\` first.`);
  }
  try {
    const parsed = JSON.parse(raw) as Credentials;
    if (parsed.version !== 1) throw new Error('unknown credentials version');
    return parsed;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `credentials file is malformed (${cause}). Run \`tempo-agent init\` to re-authenticate.`,
    );
  }
}

export async function write(creds: Credentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

// refresh calls /api/cli/refresh and overwrites the credentials file under a
// proper-lockfile mutex so two concurrent `tempo-agent connect` invocations on
// the same machine cannot race the refresh and destroy the token pair.
export async function refresh(creds: Credentials): Promise<Credentials> {
  // Precondition: caller has already called read() successfully, so the
  // credentials file exists on disk — proper-lockfile needs a real target.
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(CREDENTIALS_PATH, { retries: 3 });

    logger.debug({ user_id: creds.user_id }, 'refreshing cli token');

    const res = await fetch(`${creds.worker_url}/api/cli/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: creds.refresh_token }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`token refresh failed (HTTP ${res.status}): ${JSON.stringify(body)}`);
    }

    const data = (await res.json()) as {
      token: string;
      refresh_token: string;
      expires_at: string;
      user_id: string;
      email: string;
    };

    const refreshed: Credentials = {
      ...creds,
      token: data.token,
      refresh_token: data.refresh_token,
      issued_at: new Date().toISOString(),
      expires_at: data.expires_at,
      user_id: data.user_id,
      email: data.email,
    };

    // Write while holding the lock so any concurrent reader sees the complete pair.
    await writeFile(CREDENTIALS_PATH, JSON.stringify(refreshed, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });

    return refreshed;
  } finally {
    await release?.();
  }
}
