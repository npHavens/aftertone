'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '@/lib/api';
import {
  definitiveRejection,
  publishStorageKey,
  readPendingPublish,
  readPlaylistOperation,
  requestTimeoutMs,
  type PendingPublish,
} from '@/lib/publish-recovery';
import type { PlaylistOperation, Session } from '@/types';

export function usePublishOperation(session: Session | null) {
  const scope = session?.authenticated
    ? `${session.service}:${session.sessionScope || session.csrfToken}`
    : '';
  const canPersist = !!session?.sessionScope;
  const csrf = session?.csrfToken;
  const [pending, setPending] = useState<PendingPublish | null>(null);
  const [busy, setBusy] = useState(false);
  const [readyScope, setReadyScope] = useState<string | null>(null);
  const ready = readyScope === scope;
  const [message, setMessage] = useState('');
  const [storageWarning, setStorageWarning] = useState('');
  const current = useRef<PendingPublish | null>(null);
  const request = useRef<AbortController | null>(null);

  const save = useCallback(
    (value: PendingPublish | null) => {
      current.current = value;
      setPending(value);
      try {
        if (value && canPersist) sessionStorage.setItem(publishStorageKey, JSON.stringify(value));
        else sessionStorage.removeItem(publishStorageKey);
      } catch {
        setStorageWarning(
          'Browser storage is unavailable. Keep this tab open until the playlist outcome is confirmed.',
        );
      }
    },
    [canPersist],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      let restored = null;
      try {
        if (scope && canPersist)
          restored = readPendingPublish(sessionStorage.getItem(publishStorageKey), scope);
      } catch {
        setStorageWarning('Browser storage is unavailable. Keep this tab open while publishing.');
      }
      current.current = restored;
      setPending(restored);
      setBusy(false);
      setReadyScope(scope);
    });
    return () => {
      cancelled = true;
      request.current?.abort();
      request.current = null;
    };
  }, [scope, canPersist]);

  const send = useCallback(
    async (value: PendingPublish, previouslyUncertain: boolean) => {
      if (request.current || !scope || value.scope !== scope) return;
      const controller = new AbortController();
      request.current = controller;
      setBusy(true);
      setMessage('');
      const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs(value));
      try {
        const result = value.operation
          ? await api<PlaylistOperation>(
              `/playlist-operations/${encodeURIComponent(value.operation.id)}`,
              { signal: controller.signal },
            )
          : await api<PlaylistOperation>(
              '/playlists',
              {
                method: 'POST',
                headers: { 'Idempotency-Key': value.key },
                body: value.body,
                signal: controller.signal,
              },
              csrf,
            );
        const operation = readPlaylistOperation(result);
        if (!operation) throw new Error('The service returned an unreadable playlist result.');
        if (request.current === controller) save({ ...value, operation });
      } catch (error) {
        if (request.current !== controller) return;
        if (
          !value.operation &&
          error instanceof ApiError &&
          definitiveRejection(error.status, previouslyUncertain)
        ) {
          save(null);
          setMessage(`${errorMessage(error)} Your draft is ready to edit.`);
        } else {
          const reason = controller.signal.aborted
            ? 'The music service is taking longer than expected.'
            : errorMessage(error);
          setMessage(
            `${reason} The outcome is not confirmed. Check the same request before making another playlist.`,
          );
        }
      } finally {
        window.clearTimeout(timeout);
        if (request.current === controller) {
          request.current = null;
          setBusy(false);
        }
      }
    },
    [scope, csrf, save],
  );

  const check = useCallback(async () => {
    if (ready && current.current) await send(current.current, true);
  }, [ready, send]);

  const operationId = pending?.operation?.id;
  const operationStatus = pending?.operation?.status;
  useEffect(() => {
    if (operationStatus !== 'processing') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let remaining = 10;
    const poll = async () => {
      if (cancelled) return;
      await check();
      if (!cancelled && --remaining > 0) timer = setTimeout(() => void poll(), 2000);
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [operationId, operationStatus, check]);

  async function publish(name: string, trackIds: string[]) {
    if (!ready || !scope || current.current || request.current || !name.trim() || !trackIds.length)
      return;
    const value = {
      scope,
      key: crypto.randomUUID(),
      body: JSON.stringify({ name: name.trim(), trackIds }),
      operation: null,
    };
    save(value);
    await send(value, false);
  }

  function clear(acknowledged = false) {
    const status = current.current?.operation?.status;
    if (
      !ready ||
      current.current?.scope !== scope ||
      request.current ||
      (status !== 'completed' &&
        status !== 'failed' &&
        !(status === 'needs_attention' && acknowledged))
    )
      return false;
    save(null);
    setMessage('');
    return true;
  }

  return {
    pending: pending?.scope === scope ? pending : null,
    operation: pending?.scope === scope ? pending.operation : null,
    busy,
    message: [message, storageWarning].filter(Boolean).join(' '),
    locked: !ready || !!pending,
    publish,
    check,
    clear,
  };
}
