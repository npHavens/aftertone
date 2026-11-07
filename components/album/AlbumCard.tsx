'use client';

import { useState } from 'react';
import { ScannedCD } from '@/types';
import { TrackList } from './TrackList';
import { formatTotalDuration } from '@/lib/utils';

interface AlbumCardProps {
  cd: ScannedCD;
  onRemove: () => void;
}

export function AlbumCard({ cd, onRemove }: AlbumCardProps) {
  const [expanded, setExpanded] = useState(false);
  const album = cd.album!;

  return (
    <div className="group overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 animate-[fade-up_0.4s_ease-out] transition-colors hover:border-zinc-700">
      <div className="flex gap-3 p-3">
        {/* Cover art */}
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-zinc-800 sm:h-24 sm:w-24">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={album.coverUrl}
            alt={album.title}
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                `https://placehold.co/200x200/1a1a1a/444?text=${encodeURIComponent(album.artist[0])}`;
            }}
          />
        </div>

        {/* Metadata */}
        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div>
            <p className="truncate text-xs font-medium uppercase tracking-widest text-zinc-500">
              {album.artist}
            </p>
            <h3
              className="mt-0.5 truncate text-base font-bold text-zinc-100 leading-tight"
              style={{ fontFamily: 'var(--font-playfair)' }}
            >
              {album.title}
            </h3>
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
                {album.year}
              </span>
              <span className="text-xs text-zinc-600">{album.genre}</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-zinc-500 hover:text-amber-500 transition-colors"
            >
              {expanded
                ? '▲ Hide tracks'
                : `▼ ${album.tracks.length} tracks · ${formatTotalDuration(album.totalDurationSeconds)}`}
            </button>
          </div>
        </div>

        {/* Remove button */}
        <button
          onClick={onRemove}
          className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-600 opacity-0 transition-all hover:bg-zinc-800 hover:text-zinc-300 group-hover:opacity-100"
          aria-label="Remove album"
        >
          ✕
        </button>
      </div>

      {/* Track list */}
      {expanded && (
        <div className="border-t border-zinc-800">
          <TrackList tracks={album.tracks} />
        </div>
      )}
    </div>
  );
}
