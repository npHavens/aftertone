'use client';

import { useCallback, useRef } from 'react';
import { recognizeCD } from '@/lib/mock-recognition';
import { ScannedCD } from '@/types';

const MAX_CONCURRENT = 2;

export function useCDScanner(
  getScannedCDs: () => ScannedCD[],
  updateCD: (id: string, patch: Partial<ScannedCD>) => void,
) {
  const activeCount = useRef(0);
  const usedAlbumIds = useRef(new Set<string>());

  const processNext = useCallback(
    async (queue: ScannedCD[]) => {
      const pending = queue.filter((cd) => cd.status === 'pending');
      const slots = MAX_CONCURRENT - activeCount.current;

      for (let i = 0; i < Math.min(slots, pending.length); i++) {
        const cd = pending[i];
        activeCount.current++;
        updateCD(cd.id, { status: 'scanning' });

        recognizeCD(usedAlbumIds.current)
          .then((album) => {
            usedAlbumIds.current.add(album.id);
            updateCD(cd.id, { status: 'done', album });
          })
          .catch(() => {
            updateCD(cd.id, { status: 'error', error: 'Could not identify this CD.' });
          })
          .finally(() => {
            activeCount.current--;
            const current = getScannedCDs();
            const stillPending = current.filter((c) => c.status === 'pending');
            if (stillPending.length > 0 && activeCount.current < MAX_CONCURRENT) {
              processNext(current);
            }
          });
      }
    },
    [getScannedCDs, updateCD],
  );

  const startScanning = useCallback(
    (newCDs: ScannedCD[]) => {
      const current = getScannedCDs();
      processNext([...current, ...newCDs]);
    },
    [getScannedCDs, processNext],
  );

  return { startScanning };
}
