export type StreamingService = 'spotify' | 'apple-music';

export type ScanStatus = 'pending' | 'scanning' | 'done' | 'error';

export interface Track {
  id: string;
  number: number;
  title: string;
  durationSeconds: number;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  year: number;
  genre: string;
  coverUrl: string;
  tracks: Track[];
  totalDurationSeconds: number;
}

export interface ScannedCD {
  id: string;
  file: File;
  previewUrl: string;
  status: ScanStatus;
  album: Album | null;
  error: string | null;
}

export interface PlaylistState {
  scannedCDs: ScannedCD[];
  selectedService: StreamingService | null;
  isCreating: boolean;
  isSuccess: boolean;
}
