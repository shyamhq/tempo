import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import open from 'open';
import { type Credentials, write } from '../credentials';
import { env } from '../env';
import { logger } from '../logger';

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const PORT_RANGE_START = 49152;
const PORT_RANGE_END = 65535;

function randomPort(): number {
  return PORT_RANGE_START + Math.floor(Math.random() * (PORT_RANGE_END - PORT_RANGE_START + 1));
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function pkceVerifier(): string {
  // 43 URL-safe chars per RFC 7636 §4.1
  return base64url(randomBytes(32)).slice(0, 43);
}

function pkceChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export async function initCommand(): Promise<void> {
  const state = base64url(randomBytes(16));
  const code_verifier = pkceVerifier();
  const challenge = pkceChallenge(code_verifier);
  const port = randomPort();

  // Start local callback server
  let resolveCode: (code: string) => void;
  let rejectFlow: (err: Error) => void;

  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectFlow = reject;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    const returnedState = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');

    if (returnedState !== state) {
      res.writeHead(400);
      res.end('<p>State mismatch. Close this tab and try again.</p>');
      rejectFlow(new Error('state mismatch (possible replay)'));
      return;
    }

    if (error) {
      res.writeHead(400);
      res.end('<p>Authorization denied. Close this tab.</p>');
      rejectFlow(new Error(`user denied authorization`));
      return;
    }

    if (!code) {
      res.writeHead(400);
      res.end('<p>Missing code parameter. Close this tab and try again.</p>');
      rejectFlow(new Error('missing code in callback'));
      return;
    }

    res.writeHead(200);
    res.end(
      '<p><strong>Authenticated.</strong> You can close this tab and return to your terminal.</p>',
    );
    resolveCode(code);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  const authUrl =
    `${env.TEMPO_CONSOLE_URL}/cli/authorize` +
    `?state=${encodeURIComponent(state)}` +
    `&port=${port}` +
    `&challenge=${encodeURIComponent(challenge)}`;

  process.stdout.write(`Opening your browser to authorize tempo-agent...\n`);
  process.stdout.write(`If your browser does not open, visit:\n  ${authUrl}\n\n`);

  await open(authUrl);

  let code: string;
  const timeout = setTimeout(() => {
    rejectFlow(new Error('browser flow timed out after 5min'));
  }, CALLBACK_TIMEOUT_MS);

  try {
    code = await codePromise;
  } finally {
    clearTimeout(timeout);
    server.close();
  }

  // Exchange the code for tokens via Worker
  process.stdout.write('Exchanging authorization code...\n');

  const workerUrl = env.TEMPO_WORKER_URL;

  let exchangeRes: Response;
  try {
    exchangeRes = await fetch(`${workerUrl}/api/cli/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier }),
    });
  } catch (err) {
    process.stderr.write(`tempo init failed: token exchange failed (network error)\n`);
    logger.debug({ err }, 'cli/exchange network error');
    process.exit(1);
  }

  if (!exchangeRes.ok) {
    process.stderr.write(`tempo init failed: token exchange failed (HTTP ${exchangeRes.status})\n`);
    process.exit(1);
  }

  const data = (await exchangeRes.json()) as {
    token: string;
    refresh_token: string;
    expires_at: string;
    user_id: string;
    email: string;
  };

  const creds: Credentials = {
    version: 1,
    user_id: data.user_id,
    email: data.email,
    worker_url: workerUrl,
    token: data.token,
    refresh_token: data.refresh_token,
    issued_at: new Date().toISOString(),
    expires_at: data.expires_at,
  };

  await write(creds);

  process.stdout.write(
    `\nAuthenticated as ${data.email}. Run \`tempo-agent connect <thread-id>\` to start planning.\n`,
  );
}
