'use client';
import Image from 'next/image';
import { useId, useRef, useState } from 'react';
import { MatchSearch } from './MatchSearch';
import { serviceLink } from '@/lib/api';
import type { ScanItem, ProviderAlbum } from '@/types';
interface ReviewAlbumProps {
  item: ScanItem;
  first: boolean;
  last: boolean;
  locked: boolean;
  onChoose: (album: ProviderAlbum) => void;
  onRemove: () => void;
  onMove: (offset: number) => void;
  onRetry?: () => void;
  onToggleTrack?: (trackId: string) => void;
}
export function ReviewAlbum({
  item,
  first,
  last,
  locked,
  onChoose,
  onRemove,
  onMove,
  onRetry,
  onToggleTrack,
}: ReviewAlbumProps) {
  const [searching, setSearching] = useState(false);
  const searchId = useId();
  const searchButton = useRef<HTMLButtonElement>(null);
  const excludedTracks = new Set(item.excludedTrackIds ?? []);
  const selectedCount = item.album?.tracks.filter((track) => !excludedTracks.has(track.id)).length;
  const closeSearch = () => {
    setSearching(false);
    searchButton.current?.focus();
  };
  return (
    <article className="album-review panel">
      <div className="album-review-main">
        <Image
          unoptimized
          width={100}
          height={100}
          src={item.previewUrl}
          alt={`Uploaded cover: ${item.file.name}`}
          className="album-cover"
        />
        <div className="album-info">
          <span className={`match-status ${item.status === 'confirmed' ? 'confirmed' : ''}`}>
            {
              {
                queued: 'In the queue',
                processing: 'Finding your album…',
                review: 'Your review needed',
                confirmed: 'Added to your mix',
                error: 'Needs a little help',
              }[item.status]
            }
          </span>
          <h3>{item.album?.title || item.file.name}</h3>
          <p>
            {item.album?.artist || item.message || 'Looking for a match in your music service.'}
          </p>
          {item.album && (
            <small>
              {item.status === 'confirmed'
                ? `${selectedCount} of ${item.album.tracks.length} tracks selected`
                : `${item.album.tracks.length} tracks`}{' '}
              {serviceLink(item.album.url) && (
                <a target="_blank" rel="noreferrer" href={serviceLink(item.album.url)}>
                  View album ↗
                </a>
              )}
            </small>
          )}
          <div className="album-actions">
            {item.status === 'error' && onRetry && (
              <button className="button small" disabled={locked} onClick={onRetry}>
                Retry recognition
              </button>
            )}
            {item.album && item.status !== 'confirmed' && (
              <button
                className="button small"
                disabled={locked}
                onClick={() => onChoose(item.album!)}
              >
                Confirm album
              </button>
            )}
            <button
              ref={searchButton}
              className="text-button"
              disabled={locked}
              aria-expanded={searching}
              aria-controls={searching ? searchId : undefined}
              onClick={() => setSearching(!searching)}
            >
              Find another match
            </button>
            <button className="text-button" disabled={locked} onClick={() => onRemove()}>
              Remove
            </button>
          </div>
        </div>
        <div className="reorder">
          <button
            aria-label={`Move ${item.album?.title || item.file.name} earlier`}
            disabled={locked || first}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            aria-label={`Move ${item.album?.title || item.file.name} later`}
            disabled={locked || last}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
        </div>
      </div>
      {searching && !locked && (
        <MatchSearch
          id={searchId}
          onClose={closeSearch}
          onChoose={(album) => {
            onChoose(album);
            closeSearch();
          }}
        />
      )}
      {item.album && (
        <details>
          <summary>View tracks</summary>
          <ol className="track-list">
            {item.album.tracks.map((track) => (
              <li key={track.id}>
                <label className="track-choice">
                  <input
                    type="checkbox"
                    checked={!excludedTracks.has(track.id)}
                    disabled={locked || item.status !== 'confirmed' || !onToggleTrack}
                    aria-label={`Include ${track.title}`}
                    onChange={() => onToggleTrack?.(track.id)}
                  />
                  <span>{track.title}</span>
                </label>
                <small>
                  {track.durationMs != null
                    ? `${Math.floor(track.durationMs / 60000)}:${String(Math.floor(track.durationMs / 1000) % 60).padStart(2, '0')}`
                    : '—'}
                </small>
              </li>
            ))}
          </ol>
        </details>
      )}
    </article>
  );
}
