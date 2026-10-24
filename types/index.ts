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

// Real provider contracts. Legacy prototype types above are isolated from this flow.
export interface ProviderTrack {
  id: string;
  title: string;
  artist: string;
  durationMs: number | null;
  url: string | null;
}
export interface ProviderAlbum {
  id: string;
  service: StreamingService;
  title: string;
  artist: string;
  artworkUrl: string | null;
  url: string | null;
  tracks: ProviderTrack[];
}
export interface Session {
  authenticated: boolean;
  sessionScope?: string;
  service: StreamingService | null;
  csrfToken: string;
  capabilities: { spotify: boolean; appleMusic: boolean; recognition: boolean };
  setupRequired: string[];
}
export interface RecognitionResult {
  outcome: 'needs_review' | 'unrecognized';
  candidates: ProviderAlbum[];
  selected: ProviderAlbum | null;
  evidence: string;
  generation: string;
}
export interface ScanItem {
  id: string;
  file: File;
  previewUrl: string;
  status: 'queued' | 'processing' | 'review' | 'confirmed' | 'error';
  album: ProviderAlbum | null;
  candidates: ProviderAlbum[];
  message: string;
  excludedTrackIds?: string[];
}
export interface PlaylistOperation {
  id: string;
  status: 'completed' | 'needs_attention' | 'failed' | 'processing';
  playlistId?: string;
  playlistUrl?: string;
  addedCount: number;
  message?: string;
}
