import type { ScanItem } from '../types/index';

export function selectedTrackIds(items: ScanItem[]): string[] {
  const selected = new Set<string>();
  for (const item of items) {
    if (item.status !== 'confirmed' || !item.album) continue;
    const excluded = new Set(item.excludedTrackIds ?? []);
    for (const track of item.album.tracks) {
      if (!excluded.has(track.id)) selected.add(track.id);
    }
  }
  return [...selected];
}
