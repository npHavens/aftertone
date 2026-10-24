'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { validateImage } from '@/lib/image';
import type { ScanItem, RecognitionResult, ProviderAlbum } from '@/types';

export function useScanner(
  csrf: string | undefined,
  enabled: boolean,
  sessionIdentity: string | null,
) {
  const [items, setItems] = useState<ScanItem[]>([]);
  const [error, setError] = useState('');
  const live = useRef<ScanItem[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const credentials = useRef({ csrf, enabled });
  useEffect(() => {
    credentials.current = { csrf, enabled };
  }, [csrf, enabled]);
  const commit = useCallback((next: ScanItem[]) => {
    live.current = next;
    setItems(next);
  }, []);
  const patch = useCallback(
    (id: string, change: Partial<ScanItem>) =>
      commit(live.current.map((item) => (item.id === id ? { ...item, ...change } : item))),
    [commit],
  );
  const pumpRef = useRef<() => void>(() => {});
  const pump = useCallback(() => {
    if (!credentials.current.enabled) return;
    for (const item of live.current.filter((item) => item.status === 'queued')) {
      if (controllers.current.size >= 2) break;
      if (controllers.current.has(item.id)) continue;
      const controller = new AbortController();
      controllers.current.set(item.id, controller);
      patch(item.id, { status: 'processing' });
      const form = new FormData();
      form.set('file', item.file);
      form.set('generation', item.id);
      void api<RecognitionResult>(
        '/recognize',
        { method: 'POST', body: form, signal: controller.signal },
        credentials.current.csrf,
      )
        .then((result) => {
          if (!controller.signal.aborted)
            patch(item.id, {
              status: 'review',
              album: result.selected,
              candidates: result.candidates,
              message: result.evidence || 'Check the match before adding it to your playlist.',
            });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            patch(item.id, { status: 'error', message: errorMessage(error) });
        })
        .finally(() => {
          if (controllers.current.get(item.id) === controller) controllers.current.delete(item.id);
          pumpRef.current();
        });
    }
  }, [patch]);
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);
  const reset = useCallback(() => {
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    live.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    commit([]);
    setError('');
  }, [commit]);
  // Clear provider data before painting another account, and cancel on unmount.
  useLayoutEffect(() => () => reset(), [sessionIdentity, reset]);
  const addFiles = (files: File[]) => {
    const messages: string[] = [];
    const added: ScanItem[] = [];
    for (const file of files) {
      const issue = validateImage(file);
      if (issue) {
        messages.push(issue);
        continue;
      }
      if (live.current.length + added.length >= 20) {
        messages.push('Add up to 20 photos per playlist.');
        break;
      }
      added.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: enabled ? 'queued' : 'review',
        album: null,
        excludedTrackIds: [],
        candidates: [],
        message: enabled ? '' : 'Photo added. Search the catalog to choose its album.',
      });
    }
    commit([...live.current, ...added]);
    setError(messages.join(' '));
    pump();
  };
  const remove = (id: string) => {
    controllers.current.get(id)?.abort();
    const item = live.current.find((item) => item.id === id);
    if (item) URL.revokeObjectURL(item.previewUrl);
    commit(live.current.filter((item) => item.id !== id));
  };
  const choose = (id: string, album: ProviderAlbum) => {
    controllers.current.get(id)?.abort();
    patch(id, { album, status: 'confirmed', message: '', excludedTrackIds: [] });
  };
  const toggleTrack = (id: string, trackId: string) => {
    const item = live.current.find((item) => item.id === id);
    if (item?.status !== 'confirmed' || !item.album?.tracks.some((track) => track.id === trackId))
      return;
    const excluded = item.excludedTrackIds ?? [];
    patch(id, {
      excludedTrackIds: excluded.includes(trackId)
        ? excluded.filter((id) => id !== trackId)
        : [...excluded, trackId],
    });
  };
  const retry = (id: string) => {
    if (!credentials.current.enabled) return;
    const item = live.current.find((item) => item.id === id);
    if (item?.status !== 'error') return;
    patch(id, { status: 'queued', message: '', album: null, candidates: [] });
    pump();
  };
  const move = (id: string, offset: number) => {
    const next = [...live.current];
    const index = next.findIndex((item) => item.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  };
  return { items, error, addFiles, remove, choose, toggleTrack, retry, move, reset };
}
