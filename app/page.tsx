'use client';
import Script from 'next/script';
import Link from 'next/link';
import { Hero } from '@/components/layout/Hero';
import { ConnectionReturnNotice } from '@/components/auth/ConnectionReturnNotice';
import { ReviewAlbum } from '@/components/album/ReviewAlbum';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/hooks/useSession';
import { useScanner } from '@/hooks/useScanner';
import { api, errorMessage } from '@/lib/api';
import { selectedTrackIds } from '@/lib/playlist-selection';
import { usePublishOperation } from '@/hooks/usePublishOperation';
import { PublishResult } from '@/components/playlist/PublishResult';

type MusicKitInstance = { authorize: () => Promise<string>; unauthorize: () => Promise<void> };
declare global {
  interface Window {
    MusicKit?: {
      configure: (config: {
        developerToken: string;
        app: { name: string; build: string };
      }) => Promise<MusicKitInstance>;
      getInstance: () => MusicKitInstance;
    };
  }
}

export default function Home() {
  const { session, refresh, error: sessionError, loading } = useSession();
  const scanner = useScanner(
    session?.csrfToken,
    !!session?.authenticated && !!session.capabilities.recognition,
    session?.authenticated ? JSON.stringify([session.service, session.sessionScope]) : null,
  );
  const [notice, setNotice] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [kitLoaded, setKitLoaded] = useState(false);
  const [kitReady, setKitReady] = useState(false);
  const [name, setName] = useState('My rediscovered favorites');
  const publisher = usePublishOperation(session);
  const { operation, busy: publishing, locked } = publisher;
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const albums = scanner.items
    .filter((item) => item.status === 'confirmed' && item.album)
    .map((item) => item.album!);
  const trackIds = selectedTrackIds(scanner.items);
  const frozenDraft = publisher.pending
    ? (JSON.parse(publisher.pending.body) as { name: string; trackIds: string[] })
    : null;
  const unresolved = scanner.items.some((item) => item.status !== 'confirmed');
  const service = session?.service === 'apple-music' ? 'Apple Music' : 'Spotify';
  useEffect(() => {
    if (!kitLoaded || !session?.capabilities.appleMusic) return;
    let cancelled = false;
    void api<{ developerToken: string; app: { name: string; build: string } }>(
      '/auth/apple/developer-token',
    )
      .then(async (config) => {
        await window.MusicKit?.configure(config);
        if (!cancelled) setKitReady(true);
      })
      .catch((error) => {
        if (!cancelled) setNotice(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [kitLoaded, session?.capabilities.appleMusic]);
  async function connectApple() {
    if (!window.MusicKit || !kitReady || connecting) return;
    setConnecting(true);
    setNotice('');
    try {
      const tokenPromise = window.MusicKit.getInstance().authorize();
      const musicUserToken = await tokenPromise;
      await api(
        '/auth/apple/session',
        { method: 'POST', body: JSON.stringify({ musicUserToken }) },
        session?.csrfToken,
      );
      await refresh();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setConnecting(false);
    }
  }
  async function disconnect() {
    if (
      scanner.items.length &&
      !window.confirm('Disconnect and clear the album selections? Your playlist name will be kept.')
    )
      return;
    try {
      await api('/session', { method: 'DELETE' }, session?.csrfToken);
      scanner.reset();
      if (session?.service === 'apple-music') await window.MusicKit?.getInstance().unauthorize();
      await refresh();
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }
  const add = (files: File[]) => {
    if (session?.authenticated && !locked) scanner.addFiles(files);
  };
  return (
    <div className="app-shell">
      {session?.capabilities.appleMusic && (
        <Script
          src="https://js-cdn.music.apple.com/musickit/v3/musickit.js"
          onReady={() => setKitLoaded(true)}
          onError={() =>
            setNotice('Apple Music could not load. Check your connection and reload the page.')
          }
        />
      )}
      <a className="skip-link" href="#workspace">
        Skip to playlist builder
      </a>
      <header className="site-header">
        <Link className="wordmark" href="/" aria-label="Aftertone home">
          aftertone<span className="wordmark-dot">▦</span>
        </Link>
        <span className="header-note">Good music. Second life.</span>
        <span className="connection-indicator">
          <span className={session?.authenticated ? 'status-light connected' : 'status-light'} />
          {session?.authenticated ? `${service} connected` : 'Your personal mixtape maker'}
        </span>
      </header>
      <main id="workspace">
        <ConnectionReturnNotice />
        <Hero />
        <nav className="steps" aria-label="Playlist creation steps">
          {['Connect', 'Add photos', 'Review matches', 'Make a playlist'].map((label, index) => (
            <span
              key={label}
              className={
                (index === 0 && !session?.authenticated) ||
                (index === 1 &&
                  session?.authenticated &&
                  !scanner.items.length &&
                  !publisher.pending) ||
                (index === 2 && !!scanner.items.length && unresolved) ||
                (index === 3 && ((!!albums.length && !unresolved) || !!publisher.pending))
                  ? 'step active'
                  : 'step'
              }
            >
              <b>0{index + 1}</b>
              {label}
            </span>
          ))}
        </nav>
        {(notice || sessionError || publisher.message) && (
          <div className="alert" role="alert">
            {notice || sessionError || publisher.message}
            {sessionError && (
              <button className="text-button" onClick={() => void refresh()}>
                Retry connection check
              </button>
            )}
          </div>
        )}
        <div className="workspace-grid">
          <div className="workspace-main">
            <section className="panel connection-panel">
              <div className="section-heading">
                <h2>
                  <span className="section-number">01</span> Find your frequency.
                </h2>
                {session?.authenticated && (
                  <button
                    className="text-button"
                    disabled={locked}
                    onClick={() => void disconnect()}
                  >
                    Disconnect
                  </button>
                )}
              </div>
              <p>
                {session?.authenticated
                  ? `You're connected to ${service}. Your playlist will be saved to this account.`
                  : 'Connect your music service. Your next favorite playlist starts here.'}
              </p>
              {!session?.authenticated && (
                <div className="provider-buttons">
                  <button
                    className="provider-button"
                    disabled={loading || !session?.capabilities.spotify || connecting}
                    onClick={() => {
                      setConnecting(true);
                      window.location.assign('/api/auth/spotify/login');
                    }}
                  >
                    <span>Connect Spotify</span>
                  </button>
                  <button
                    className="provider-button"
                    disabled={
                      loading || !session?.capabilities.appleMusic || !kitReady || connecting
                    }
                    onClick={() => void connectApple()}
                  >
                    <span>Connect Apple Music</span>
                  </button>
                </div>
              )}
              {loading && (
                <p role="status" className="helper">
                  Checking your connection…
                </p>
              )}
              {!loading &&
                !session?.authenticated &&
                (!session || !session.capabilities.spotify || !session.capabilities.appleMusic) && (
                  <div className="setup-note">
                    <span aria-hidden="true">▧</span>
                    <p>
                      <strong>Getting the turntable ready.</strong>
                      <br />
                      {!session
                        ? 'The local music service is not running yet. Start it, then retry the connection check.'
                        : 'Music connections need to be configured before you can sign in. Available services will light up here.'}
                    </p>
                  </div>
                )}
            </section>
            <section className="panel photos-panel">
              <div className="section-heading">
                <h2>
                  <span className="section-number">02</span> Give your shelf a spin.
                </h2>
                {scanner.items.length > 0 && (
                  <button
                    className="text-button"
                    disabled={locked}
                    onClick={() => {
                      scanner.reset();
                    }}
                  >
                    Clear photos
                  </button>
                )}
              </div>
              <p>One album cover per photo. We’ll find it; you get the final say.</p>
              <div
                className={`drop-zone ${dragging ? 'dragging' : ''} ${!session?.authenticated ? 'upload-disabled' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (session?.authenticated && !locked) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  add(Array.from(event.dataTransfer.files));
                }}
              >
                <div className="upload-icon" aria-hidden="true">
                  ▧<span>+</span>
                </div>
                <h3>Drop your album photos here.</h3>
                <p>Or dig them out of your camera roll.</p>
                <button
                  className="button"
                  disabled={!session?.authenticated || locked}
                  onClick={() => picker.current?.click()}
                >
                  Choose photos <span aria-hidden="true">↗</span>
                </button>
                <input
                  ref={picker}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  hidden
                  onChange={(event) => {
                    add(Array.from(event.target.files || []));
                    event.target.value = '';
                  }}
                />
                <small>
                  {session?.authenticated
                    ? 'JPG, PNG or WebP · Up to 10 MB each · 20 photos'
                    : 'Connect a music service to add photos.'}
                </small>
              </div>
              {session?.authenticated && !session.capabilities.recognition && (
                <p className="helper">
                  Photo recognition isn’t configured yet. You can still add photos and search for
                  each album yourself.
                </p>
              )}
              {scanner.error && (
                <p className="alert" role="alert">
                  {scanner.error}
                </p>
              )}
            </section>
            {!!scanner.items.length && (
              <section className="review-section">
                <div className="section-heading">
                  <h2>
                    <span className="section-number">03</span> Looking like your kind of mix.
                  </h2>
                  <span>{scanner.items.length} photos</span>
                </div>
                <p className="helper">
                  Confirm each album. Use the arrows to set the order; repeated tracks are included
                  only once.
                </p>
                <div className="album-list">
                  {scanner.items.map((item, index) => (
                    <ReviewAlbum
                      key={item.id}
                      item={item}
                      first={index === 0}
                      last={index === scanner.items.length - 1}
                      locked={locked}
                      onChoose={(album) => scanner.choose(item.id, album)}
                      onToggleTrack={(trackId) => scanner.toggleTrack(item.id, trackId)}
                      onRetry={
                        session?.capabilities.recognition ? () => scanner.retry(item.id) : undefined
                      }
                      onRemove={() => scanner.remove(item.id)}
                      onMove={(offset) => scanner.move(item.id, offset)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
          <aside className="playlist-summary panel">
            <div className="summary-strip">Your next repeat listen</div>
            <div className="summary-body">
              <div className="mix-icon" aria-hidden="true">
                ▤
              </div>
              <h2>The mix starts here.</h2>
              <p>
                A little nostalgia.
                <br />A whole new playlist.
              </p>
              <label htmlFor="playlist-name">Playlist name</label>
              <input
                id="playlist-name"
                value={frozenDraft?.name || name}
                maxLength={100}
                disabled={locked}
                onChange={(event) => setName(event.target.value)}
              />
              <div className="mix-counts">
                <div>
                  <strong>{albums.length.toString().padStart(2, '0')}</strong>
                  <span>albums</span>
                </div>
                <div>
                  <strong>
                    {(frozenDraft?.trackIds.length ?? trackIds.length).toString().padStart(2, '0')}
                  </strong>
                  <span>tracks</span>
                </div>
              </div>
              <div className="destination">
                Save to <strong>{session?.authenticated ? service : 'your music service'}</strong>
              </div>
              <button
                className="button publish-button"
                disabled={
                  !session?.authenticated ||
                  !trackIds.length ||
                  trackIds.length > 500 ||
                  unresolved ||
                  !name.trim() ||
                  locked
                }
                onClick={() => void publisher.publish(name, trackIds)}
              >
                {publishing ? 'Saving your playlist…' : 'Make my playlist'}{' '}
                <span aria-hidden="true">▶</span>
              </button>
              <p className="helper">
                {trackIds.length > 500
                  ? 'Choose 500 tracks or fewer. Open an album’s track list to deselect songs.'
                  : unresolved
                    ? 'Review every album before creating your playlist.'
                    : albums.length > 0 && !trackIds.length
                      ? 'Choose at least one track from your albums to create a playlist.'
                      : 'Your albums, in your order. Ready when you are.'}
              </p>
              {publisher.pending && (
                <PublishResult
                  operation={operation}
                  busy={publishing}
                  service={service}
                  onCheck={() => void publisher.check()}
                  onEditMix={() => {
                    if (publisher.clear() && frozenDraft) setName(frozenDraft.name);
                  }}
                  onNewMix={(acknowledged) => {
                    if (publisher.clear(acknowledged)) scanner.reset();
                  }}
                />
              )}
            </div>
            <div className="summary-footer" aria-hidden="true">
              <span>▮▮▮ ▮▮ ▮▮▮▮ ▮▮</span>
              <span>MADE FOR ANOTHER SPIN</span>
            </div>
          </aside>
        </div>
        <footer className="site-footer">
          <span className="footer-wordmark">aftertone</span>
          <p>Your collection has more to give.</p>
          <span>Less scrolling. More listening.</span>
        </footer>
      </main>
    </div>
  );
}
