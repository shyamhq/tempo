'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useMemo } from 'react';
import { workerApi } from '../lib/api-client';

// Returns a stable workerApi instance bound to the current Clerk JWT.
// The getToken reference from useAuth is stable across renders (Clerk guarantees
// this), so the returned api object is also stable and safe to use in useMemo
// dependency arrays.
export function useWorkerApi() {
  const { getToken } = useAuth();
  const getWorkerToken = useCallback(() => getToken(), [getToken]);
  return useMemo(() => workerApi(getWorkerToken), [getWorkerToken]);
}
