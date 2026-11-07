'use client';

import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';

interface DropZoneProps {
  onFilesAdded: (files: File[]) => void;
  compact?: boolean;
}

export function DropZone({ onFilesAdded, compact = false }: DropZoneProps) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) onFilesAdded(accepted);
    },
    [onFilesAdded],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: true,
  });

  if (compact) {
    return (
      <div
        {...getRootProps()}
        className={cn(
          'flex cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-4 transition-all duration-200',
          isDragActive
            ? 'border-amber-500 bg-amber-500/10'
            : 'border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900',
        )}
      >
        <input {...getInputProps()} />
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 text-zinc-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 5v14M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-sm text-zinc-400">
          {isDragActive ? 'Drop to add more...' : 'Add more CDs'}
        </span>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={cn(
        'flex min-h-[52vh] cursor-pointer flex-col items-center justify-center gap-6 rounded-2xl border-2 border-dashed px-8 py-16 transition-all duration-300',
        isDragActive
          ? 'scale-[1.01] border-amber-500 bg-amber-500/10'
          : 'border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900/50',
      )}
    >
      <input {...getInputProps()} />

      {/* Vinyl record SVG */}
      <div className={cn('transition-transform duration-500', isDragActive && 'scale-110')}>
        <svg
          viewBox="0 0 120 120"
          className={cn(
            'h-28 w-28 text-zinc-600 transition-colors duration-300',
            isDragActive && 'text-amber-500',
          )}
          fill="currentColor"
        >
          <circle cx="60" cy="60" r="58" />
          <circle cx="60" cy="60" r="50" fill="#0a0a0a" />
          <circle cx="60" cy="60" r="42" opacity="0.4" />
          <circle cx="60" cy="60" r="34" fill="#0a0a0a" />
          <circle cx="60" cy="60" r="26" opacity="0.3" />
          <circle cx="60" cy="60" r="18" fill="#0a0a0a" />
          <circle cx="60" cy="60" r="10" opacity="0.4" />
          <circle cx="60" cy="60" r="5" fill="#1a1a1a" />
          <circle cx="60" cy="60" r="2.5" fill="currentColor" opacity="0.8" />
        </svg>
      </div>

      <div className="text-center">
        <p
          className="text-2xl font-bold text-zinc-200"
          style={{ fontFamily: 'var(--font-playfair)' }}
        >
          {isDragActive ? 'Drop your CDs here' : 'Drop CD photos here'}
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          or <span className="text-amber-500 underline underline-offset-2">click to browse</span> —
          supports JPG, PNG, HEIC
        </p>
      </div>

      <div className="flex items-center gap-8 text-xs text-zinc-600">
        <span className="flex items-center gap-1.5">
          <span className="h-5 w-5 rounded-full bg-zinc-800 flex items-center justify-center text-amber-500 text-xs font-bold">
            1
          </span>
          Drop photos
        </span>
        <span className="text-zinc-800">→</span>
        <span className="flex items-center gap-1.5">
          <span className="h-5 w-5 rounded-full bg-zinc-800 flex items-center justify-center text-amber-500 text-xs font-bold">
            2
          </span>
          Identify albums
        </span>
        <span className="text-zinc-800">→</span>
        <span className="flex items-center gap-1.5">
          <span className="h-5 w-5 rounded-full bg-zinc-800 flex items-center justify-center text-amber-500 text-xs font-bold">
            3
          </span>
          Create playlist
        </span>
      </div>
    </div>
  );
}
