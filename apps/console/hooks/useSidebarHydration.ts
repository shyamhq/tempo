'use client';

// Seeds the sidebar slice once on shell mount — the rail's equivalent of
// hydrateThread for live thread state. Spaces are non-realtime, so a single
// fetch of the whole tree (spaces + threads per space) replaces the slice; after
// that, mutations edit the slice in place and re-seed only on failure.
//
// Degrades gracefully: a failed fetch logs (dev only) and leaves the rail empty
// rather than throwing through the shell.

import { useEffect } from 'react';
import { getSpaces } from '../features/sidebar/api';
import { useThreadStore } from '../store';

export function useSidebarHydration(): void {
  useEffect(() => {
    let cancelled = false;
    getSpaces()
      .then((tree) => {
        if (!cancelled) useThreadStore.getState().setSidebar(tree);
      })
      .catch((e) => {
        if (process.env.NODE_ENV !== 'production') {
          console.error('useSidebarHydration: load failed', e);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
}
