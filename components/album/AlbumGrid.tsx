'use client';

import { ScannedCD } from '@/types';
import { AlbumCard } from './AlbumCard';
import { ScanningCard } from '@/components/scanning/ScanningCard';
import { DropZone } from '@/components/upload/DropZone';

interface AlbumGridProps {
  scannedCDs: ScannedCD[];
  onRemove: (id: string) => void;
  onFilesAdded: (files: File[]) => void;
}

export function AlbumGrid({ scannedCDs, onRemove, onFilesAdded }: AlbumGridProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {scannedCDs.map((cd) =>
          cd.status === 'done' && cd.album ? (
            <AlbumCard key={cd.id} cd={cd} onRemove={() => onRemove(cd.id)} />
          ) : cd.status === 'error' ? (
            <div
              key={cd.id}
              className="flex items-center gap-3 rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-400"
            >
              <span>⚠</span>
              <span>{cd.error ?? 'Could not identify this CD.'}</span>
              <button
                onClick={() => onRemove(cd.id)}
                className="ml-auto text-xs text-red-600 hover:text-red-400"
              >
                Dismiss
              </button>
            </div>
          ) : (
            <ScanningCard key={cd.id} cd={cd} />
          ),
        )}
      </div>

      <DropZone onFilesAdded={onFilesAdded} compact />
    </div>
  );
}
