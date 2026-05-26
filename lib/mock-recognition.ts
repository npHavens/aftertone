import { Album } from '@/types';
import { MOCK_ALBUMS } from './mock-albums';

export async function recognizeCD(usedAlbumIds: Set<string>): Promise<Album> {
  const delay = 1800 + Math.random() * 1400;
  await new Promise((resolve) => setTimeout(resolve, delay));

  const available = MOCK_ALBUMS.filter((a) => !usedAlbumIds.has(a.id));
  const pool = available.length > 0 ? available : MOCK_ALBUMS;
  return pool[Math.floor(Math.random() * pool.length)];
}
