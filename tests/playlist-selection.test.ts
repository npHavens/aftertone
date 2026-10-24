import assert from 'node:assert/strict';
import test from 'node:test';
import { selectedTrackIds } from '../lib/playlist-selection.ts';
import type { ScanItem } from '../types/index.ts';

function scan(id: string, tracks: string[], excludedTrackIds: string[] = []): ScanItem {
  return {
    id,
    file: new File(['cover'], `${id}.png`, { type: 'image/png' }),
    previewUrl: `blob:${id}`,
    status: 'confirmed',
    candidates: [],
    message: '',
    excludedTrackIds,
    album: {
      id,
      service: 'spotify',
      title: id,
      artist: 'Test artist',
      artworkUrl: null,
      url: null,
      tracks: tracks.map((trackId) => ({
        id: trackId,
        title: trackId,
        artist: 'Test artist',
        durationMs: null,
        url: null,
      })),
    },
  };
}

test('keeps album and track order while including repeated canonical tracks only once', () => {
  const first = scan('first', ['b', 'a']);
  const second = scan('second', ['a', 'c']);
  assert.deepEqual(selectedTrackIds([first, second]), ['b', 'a', 'c']);
  assert.deepEqual(selectedTrackIds([second, first]), ['a', 'c', 'b']);
});

test('exclusions apply to their album without suppressing an included occurrence elsewhere', () => {
  const first = scan('first', ['a', 'b'], ['a', 'unknown']);
  const second = scan('second', ['a', 'c']);
  assert.deepEqual(selectedTrackIds([first, second]), ['b', 'a', 'c']);
  second.excludedTrackIds = ['a'];
  assert.deepEqual(selectedTrackIds([first, second]), ['b', 'c']);
});

test('ignores unconfirmed matches and absent albums, and permits excluding every track', () => {
  const review = scan('review', ['unconfirmed']);
  review.status = 'review';
  const missing = scan('missing', ['absent']);
  missing.album = null;
  const excluded = scan('excluded', ['a', 'b'], ['a', 'b']);
  assert.deepEqual(selectedTrackIds([review, missing, excluded]), []);
});

test('existing scans without exclusions include their canonical tracks', () => {
  const item = scan('existing', ['a', 'b']);
  delete item.excludedTrackIds;
  assert.deepEqual(selectedTrackIds([item]), ['a', 'b']);
});
