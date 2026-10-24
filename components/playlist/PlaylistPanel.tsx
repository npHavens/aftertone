'use client';

import { StreamingService } from '@/types';
import { formatTotalDuration } from '@/lib/utils';
import { ServiceSelector } from './ServiceSelector';
import { CreatePlaylistButton } from './CreatePlaylistButton';

interface PlaylistPanelProps {
  albumCount: number;
  trackCount: number;
  totalDuration: number;
  selectedService: StreamingService | null;
  isCreating: boolean;
  onSelectService: (s: StreamingService) => void;
  onCreatePlaylist: () => void;
}

export function PlaylistPanel({
  albumCount,
  trackCount,
  totalDuration,
  selectedService,
  isCreating,
  onSelectService,
  onCreatePlaylist,
}: PlaylistPanelProps) {
  if (albumCount === 0) return null;

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col gap-4 w-72 shrink-0">
        <div className="sticky top-20 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 space-y-4">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
              Your Playlist
            </h2>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-zinc-800 py-2 px-1">
                <p className="text-xl font-bold text-zinc-100">{albumCount}</p>
                <p className="text-xs text-zinc-500">Albums</p>
              </div>
              <div className="rounded-lg bg-zinc-800 py-2 px-1">
                <p className="text-xl font-bold text-zinc-100">{trackCount}</p>
                <p className="text-xs text-zinc-500">Tracks</p>
              </div>
              <div className="rounded-lg bg-zinc-800 py-2 px-1">
                <p className="text-base font-bold text-zinc-100 leading-tight pt-0.5">
                  {formatTotalDuration(totalDuration)}
                </p>
                <p className="text-xs text-zinc-500">Duration</p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-zinc-500 font-medium">Add to</p>
            <ServiceSelector selected={selectedService} onChange={onSelectService} />
          </div>

          <CreatePlaylistButton
            service={selectedService}
            isCreating={isCreating}
            albumCount={albumCount}
            onClick={onCreatePlaylist}
          />
        </div>
      </aside>

      {/* Mobile bottom bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-sm px-4 py-3 space-y-2">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>
            {albumCount} albums · {trackCount} tracks · {formatTotalDuration(totalDuration)}
          </span>
        </div>
        <ServiceSelector selected={selectedService} onChange={onSelectService} />
        <CreatePlaylistButton
          service={selectedService}
          isCreating={isCreating}
          albumCount={albumCount}
          onClick={onCreatePlaylist}
        />
      </div>
    </>
  );
}
