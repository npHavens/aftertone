'use client';

import { Track } from '@/types';
import { formatDuration } from '@/lib/utils';

interface TrackListProps {
  tracks: Track[];
}

export function TrackList({ tracks }: TrackListProps) {
  return (
    <ol className="divide-y divide-zinc-800 text-sm">
      {tracks.map((track, i) => (
        <li
          key={track.id}
          className={`flex items-center gap-3 px-3 py-2 ${i % 2 === 0 ? 'bg-zinc-900' : 'bg-zinc-900/50'}`}
        >
          <span className="w-5 shrink-0 text-right text-xs text-zinc-600">{track.number}</span>
          <span className="flex-1 truncate text-zinc-300">{track.title}</span>
          <span className="shrink-0 text-xs tabular-nums text-zinc-600">
            {formatDuration(track.durationSeconds)}
          </span>
        </li>
      ))}
    </ol>
  );
}
