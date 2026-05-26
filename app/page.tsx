'use client';

import { usePlaylist } from '@/hooks/usePlaylist';
import { Header } from '@/components/layout/Header';
import { DropZone } from '@/components/upload/DropZone';
import { AlbumGrid } from '@/components/album/AlbumGrid';
import { PlaylistPanel } from '@/components/playlist/PlaylistPanel';
import { SuccessModal } from '@/components/modals/SuccessModal';

export default function Home() {
  const {
    state,
    detectedAlbums,
    totalTracks,
    totalDuration,
    addFiles,
    removeCD,
    selectService,
    createPlaylist,
    dismissSuccess,
    reset,
  } = usePlaylist();

  const hasItems = state.scannedCDs.length > 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <Header />

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6 pb-48 lg:pb-6">
        {!hasItems ? (
          /* Empty state — full hero drop zone */
          <div className="mt-8">
            <div className="mb-8 text-center">
              <h1
                className="text-4xl font-bold text-zinc-100 sm:text-5xl"
                style={{ fontFamily: 'var(--font-playfair)' }}
              >
                Your CDs,{' '}
                <span className="text-amber-500">as a playlist</span>
              </h1>
              <p className="mt-3 text-zinc-500 text-base sm:text-lg max-w-md mx-auto">
                Photograph your CD collection and we'll build a Spotify or Apple Music playlist instantly.
              </p>
            </div>
            <DropZone onFilesAdded={addFiles} />
          </div>
        ) : (
          /* Active state — grid + sidebar */
          <div className="flex gap-6">
            <div className="flex-1 min-w-0">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-widest">
                  {state.scannedCDs.length} CD{state.scannedCDs.length !== 1 ? 's' : ''} added
                </h2>
                <button
                  onClick={reset}
                  className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  Start over
                </button>
              </div>
              <AlbumGrid
                scannedCDs={state.scannedCDs}
                onRemove={removeCD}
                onFilesAdded={addFiles}
              />
            </div>

            <PlaylistPanel
              albumCount={detectedAlbums.length}
              trackCount={totalTracks}
              totalDuration={totalDuration}
              selectedService={state.selectedService}
              isCreating={state.isCreating}
              onSelectService={selectService}
              onCreatePlaylist={createPlaylist}
            />
          </div>
        )}
      </main>

      {state.isSuccess && state.selectedService && (
        <SuccessModal
          service={state.selectedService}
          albumCount={detectedAlbums.length}
          trackCount={totalTracks}
          onDone={reset}
          onAddMore={dismissSuccess}
        />
      )}
    </div>
  );
}
