'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { Session } from '@/types';
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const latest = useRef<AbortController | null>(null);
  // Each check aborts the one before it, so an older response can never replace a newer one.
  // State is set in promise callbacks, not after an await, so the hooks lint accepts calling
  // this from the effect below.
  const load = useCallback(() => {
    latest.current?.abort();
    const controller = new AbortController();
    latest.current = controller;
    return api<Session>('/session', { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setSession(next);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, []);
  // Resolves when this check settles, or at once if a newer check replaces it. The newer check
  // then applies the session and keeps `loading` set until it does.
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    await load();
  }, [load]);
  useEffect(() => {
    void load();
    return () => latest.current?.abort();
  }, [load]);
  return { session, refresh, error, loading };
}
