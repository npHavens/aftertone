'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { Session } from '@/types';
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSession(await api<Session>('/session'));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void api<Session>('/session', { signal: controller.signal })
      .then(setSession)
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  return { session, refresh, error, loading };
}
