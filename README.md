# Discify — CD to Playlist

Turn your physical CD collection into a streaming playlist. Photograph (or upload images of) your CDs, Discify recognizes each album, and builds a single Spotify or Apple Music playlist from everything you scanned.

## How it works

1. **Drop in photos** — drag-and-drop or select images of your CDs.
2. **Recognition** — each image is matched to an album, pulling in cover art, tracklist, and durations.
3. **Review** — see your detected albums in a grid with full tracklists, plus a running total of tracks and listening time.
4. **Create** — pick Spotify or Apple Music and generate the playlist.

## Status

This is a **front-end prototype**. The album recognition and playlist creation are currently **mocked**:

- `lib/mock-recognition.ts` simulates recognition latency and returns albums from `lib/mock-albums.ts` instead of calling a real image-recognition service.
- `createPlaylist` in `hooks/usePlaylist.ts` simulates a request with a timeout rather than hitting the Spotify or Apple Music APIs.

Wiring up real recognition and streaming-service integrations are the natural next steps.

## Tech stack

- **Next.js 16** (App Router) and **React 19**
- **Tailwind CSS 4**
- **Framer Motion** for animations and **canvas-confetti** for the success state
- **react-dropzone** for uploads
- **TypeScript**

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Build for production |
| `npm run start` | Run the production build |

## Project structure

```
app/                 App Router entry, layout, and the main page
components/
  album/             Album grid, cards, and tracklists
  upload/            Drop zone
  playlist/          Service selector and playlist panel
  scanning/          Recognition progress UI
  modals/            Success modal
  layout/            Header
hooks/
  usePlaylist.ts     Top-level state: scanned CDs, totals, playlist actions
  useCDScanner.ts    Drives recognition for added files
lib/
  mock-recognition.ts  Simulated album recognition
  mock-albums.ts       Sample album data
  utils.ts
types/               Shared TypeScript types
```
