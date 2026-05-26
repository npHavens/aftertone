'use client';

import { ScannedCD } from '@/types';
import { ScanProgress } from './ScanProgress';

interface ScanningCardProps {
  cd: ScannedCD;
}

export function ScanningCard({ cd }: ScanningCardProps) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 animate-[fade-up_0.3s_ease-out]">
      {/* Thumbnail */}
      <div className="relative aspect-square w-full overflow-hidden bg-zinc-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cd.previewUrl}
          alt="CD photo"
          className="h-full w-full object-cover opacity-30 blur-sm"
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <ScanProgress />
        </div>
      </div>

      <div className="p-3">
        <div className="h-3 w-3/4 rounded bg-zinc-800 animate-pulse" />
        <div className="mt-2 h-2.5 w-1/2 rounded bg-zinc-800 animate-pulse" />
      </div>
    </div>
  );
}
