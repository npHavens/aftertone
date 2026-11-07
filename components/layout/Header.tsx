'use client';

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <svg viewBox="0 0 24 24" className="h-7 w-7 text-amber-500" fill="currentColor">
          <circle cx="12" cy="12" r="10" opacity="0.15" />
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="1.5" />
        </svg>
        <span
          className="text-xl font-bold tracking-tight text-zinc-100"
          style={{ fontFamily: 'var(--font-playfair)' }}
        >
          Aftertone
        </span>
        <span className="ml-1 text-xs text-zinc-500 font-medium tracking-widest uppercase">
          CD to Playlist
        </span>
      </div>
    </header>
  );
}
