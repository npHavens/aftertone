'use client';

import { useEffect } from 'react';
import { StreamingService } from '@/types';

interface SuccessModalProps {
  service: StreamingService;
  albumCount: number;
  trackCount: number;
  onDone: () => void;
  onAddMore: () => void;
}

export function SuccessModal({
  service,
  albumCount,
  trackCount,
  onDone,
  onAddMore,
}: SuccessModalProps) {
  useEffect(() => {
    let confetti: typeof import('canvas-confetti') | null = null;
    const timer = setTimeout(async () => {
      const mod = await import('canvas-confetti');
      confetti = mod.default;
      confetti({
        particleCount: 120,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#f59e0b', '#d97706', '#fbbf24', '#fef3c7', '#ffffff'],
      });
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  const isSpotify = service === 'spotify';
  const serviceName = isSpotify ? 'Spotify' : 'Apple Music';
  const accentColor = isSpotify ? '#1DB954' : '#FA2D48';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onAddMore} />

      {/* Card */}
      <div className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl animate-[fade-up_0.35s_cubic-bezier(0.34,1.56,0.64,1)]">
        {/* Icon */}
        <div
          className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full"
          style={{ backgroundColor: `${accentColor}20`, border: `2px solid ${accentColor}` }}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-8 w-8"
            fill="none"
            stroke={accentColor}
            strokeWidth="2.5"
          >
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <h2
          className="text-center text-xl font-bold text-zinc-100"
          style={{ fontFamily: 'var(--font-playfair)' }}
        >
          Playlist Created!
        </h2>

        <p className="mt-2 text-center text-sm text-zinc-400">
          <span className="font-medium" style={{ color: accentColor }}>
            My CD Collection
          </span>{' '}
          has been added to {serviceName} with{' '}
          <span className="text-zinc-200 font-medium">{albumCount} albums</span> and{' '}
          <span className="text-zinc-200 font-medium">{trackCount} tracks</span>.
        </p>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onAddMore}
            className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
          >
            Add More CDs
          </button>
          <button
            onClick={onDone}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold transition-colors"
            style={{ backgroundColor: accentColor, color: isSpotify ? 'black' : 'white' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
