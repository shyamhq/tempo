'use client';

import { useState } from 'react';
import { mintCliCode } from './actions';

interface Props {
  email: string;
  state: string;
  port: number;
  challenge: string;
}

// Client component: handles the Allow / Deny interaction for the CLI OAuth
// code flow. Calls the mintCliCode server action on Allow, then redirects the
// browser to the CLI's local callback server.
export function AuthorizeClient({ email, state, port, challenge }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  async function handleAllow() {
    setStatus('loading');
    try {
      const { redirectUrl } = await mintCliCode({ state, port, challenge });
      window.location.href = redirectUrl;
    } catch {
      setStatus('error');
    }
  }

  function handleDeny() {
    window.location.href = `http://127.0.0.1:${port}/callback?error=denied&state=${encodeURIComponent(state)}`;
  }

  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8">
      <h1 className="mb-1 text-base font-semibold text-text">Authorize Tempo CLI</h1>
      <p className="mb-6 text-sm text-text-secondary">
        The Tempo CLI is requesting access as <strong>{email}</strong>.
      </p>

      {status === 'error' && (
        <p className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Something went wrong. Please try again.
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleAllow}
          disabled={status === 'loading'}
          className="flex-1 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {status === 'loading' ? 'Authorizing…' : 'Allow'}
        </button>
        <button
          type="button"
          onClick={handleDeny}
          disabled={status === 'loading'}
          className="flex-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-text disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
