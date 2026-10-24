'use client';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { ProviderAlbum } from '@/types';

export function MatchSearch({
  id,
  onChoose,
  onClose,
}: {
  id: string;
  onChoose: (album: ProviderAlbum) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [albums, setAlbums] = useState<ProviderAlbum[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [choosingId, setChoosingId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancel() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    controller.current?.abort();
  }

  useEffect(() => () => cancel(), []);

  function close() {
    cancel();
    onClose();
  }

  async function search(value: string) {
    cancel();
    const trimmed = value.trim();
    if (!trimmed) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setChoosingId(null);
    setAlbums([]);
    setMessage('Searching your music service…');
    try {
      const result = await api<{ albums: ProviderAlbum[] }>(
        `/albums/search?q=${encodeURIComponent(trimmed)}`,
        { signal: request.signal },
      );
      if (request.signal.aborted) return;
      setAlbums(result.albums);
      setMessage(
        result.albums.length
          ? `${result.albums.length} albums found. Choose a match to load its tracks.`
          : 'No albums found. Try the artist and album title.',
      );
    } catch (error) {
      if (!request.signal.aborted) setMessage(errorMessage(error));
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }

  function changeQuery(value: string) {
    cancel();
    setQuery(value);
    setAlbums([]);
    setChoosingId(null);
    setBusy(!!value.trim());
    setMessage(value.trim() ? 'Waiting to search…' : '');
    if (value.trim()) timer.current = setTimeout(() => void search(value), 350);
  }

  async function choose(album: ProviderAlbum) {
    cancel();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setChoosingId(album.id);
    setMessage(`Loading tracks for ${album.title}…`);
    try {
      const selected = await api<ProviderAlbum>(`/albums/${encodeURIComponent(album.id)}`, {
        signal: request.signal,
      });
      if (!request.signal.aborted) onChoose(selected);
    } catch (error) {
      if (!request.signal.aborted) setMessage(errorMessage(error));
    } finally {
      if (!request.signal.aborted) {
        setBusy(false);
        setChoosingId(null);
      }
    }
  }

  return (
    <section
      id={id}
      className="match-search"
      aria-labelledby={`${id}-heading`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className="section-heading">
        <h4 id={`${id}-heading`}>Find the right album</h4>
        <button className="text-button" onClick={close}>
          Close search
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search(query);
        }}
      >
        <label>
          Artist or album title
          <input
            autoFocus
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder="Search your music service"
            maxLength={200}
            aria-controls={`${id}-results`}
            aria-describedby={`${id}-status`}
          />
        </label>
        <button className="button small" disabled={busy || !query.trim()}>
          {choosingId ? 'Loading tracks…' : busy ? 'Searching…' : 'Search'}
        </button>
      </form>
      <p id={`${id}-status`} role="status">
        {message}
      </p>
      <ul id={`${id}-results`} className="search-results" aria-busy={busy}>
        {albums.map((album) => (
          <li key={album.id}>
            <span>
              <strong>{album.title}</strong>
              <small>{album.artist}</small>
            </span>
            <button
              className="button secondary small"
              disabled={busy}
              aria-label={`Choose ${album.title} by ${album.artist}`}
              onClick={() => void choose(album)}
            >
              {choosingId === album.id ? 'Loading…' : 'Choose'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
