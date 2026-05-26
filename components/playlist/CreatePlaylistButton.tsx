'use client';

import { StreamingService } from '@/types';
import { cn } from '@/lib/utils';

interface CreatePlaylistButtonProps {
  service: StreamingService | null;
  isCreating: boolean;
  albumCount: number;
  onClick: () => void;
}

const SERVICE_COLORS = {
  spotify: 'bg-[#1DB954] hover:bg-[#1ed760] text-black',
  'apple-music': 'bg-[#FA2D48] hover:bg-[#fc4560] text-white',
};

export function CreatePlaylistButton({
  service,
  isCreating,
  albumCount,
  onClick,
}: CreatePlaylistButtonProps) {
  const disabled = !service || albumCount === 0 || isCreating;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full rounded-xl px-4 py-3 text-sm font-bold transition-all duration-200',
        service && !disabled
          ? SERVICE_COLORS[service]
          : 'cursor-not-allowed bg-zinc-800 text-zinc-600',
        isCreating && 'opacity-80',
      )}
    >
      {isCreating ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Creating playlist...
        </span>
      ) : !service ? (
        'Select a service above'
      ) : albumCount === 0 ? (
        'Add albums first'
      ) : (
        `Create Playlist on ${service === 'spotify' ? 'Spotify' : 'Apple Music'}`
      )}
    </button>
  );
}
