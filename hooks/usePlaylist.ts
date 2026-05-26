'use client';

import { useCallback, useRef, useState } from 'react';
import { PlaylistState, ScannedCD, StreamingService } from '@/types';
import { useCDScanner } from './useCDScanner';

function createScannedCD(file: File): ScannedCD {
  return {
    id: crypto.randomUUID(),
    file,
    previewUrl: URL.createObjectURL(file),
    status: 'pending',
    album: null,
    error: null,
  };
}

const INITIAL_STATE: PlaylistState = {
  scannedCDs: [],
  selectedService: null,
  isCreating: false,
  isSuccess: false,
};

export function usePlaylist() {
  const [state, setState] = useState<PlaylistState>(INITIAL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

  const updateCD = useCallback((id: string, patch: Partial<ScannedCD>) => {
    setState((prev) => ({
      ...prev,
      scannedCDs: prev.scannedCDs.map((cd) => (cd.id === id ? { ...cd, ...patch } : cd)),
    }));
  }, []);

  const getScannedCDs = useCallback(() => stateRef.current.scannedCDs, []);

  const { startScanning } = useCDScanner(getScannedCDs, updateCD);

  const addFiles = useCallback(
    (files: File[]) => {
      const newCDs = files.map(createScannedCD);
      setState((prev) => ({
        ...prev,
        scannedCDs: [...prev.scannedCDs, ...newCDs],
      }));
      startScanning(newCDs);
    },
    [startScanning],
  );

  const removeCD = useCallback((id: string) => {
    setState((prev) => {
      const cd = prev.scannedCDs.find((c) => c.id === id);
      if (cd?.previewUrl) URL.revokeObjectURL(cd.previewUrl);
      return {
        ...prev,
        scannedCDs: prev.scannedCDs.filter((c) => c.id !== id),
      };
    });
  }, []);

  const selectService = useCallback((service: StreamingService) => {
    setState((prev) => ({ ...prev, selectedService: service }));
  }, []);

  const createPlaylist = useCallback(() => {
    setState((prev) => ({ ...prev, isCreating: true }));
    setTimeout(() => {
      setState((prev) => ({ ...prev, isCreating: false, isSuccess: true }));
    }, 1500);
  }, []);

  const dismissSuccess = useCallback(() => {
    setState((prev) => ({ ...prev, isSuccess: false }));
  }, []);

  const reset = useCallback(() => {
    setState((prev) => {
      prev.scannedCDs.forEach((cd) => {
        if (cd.previewUrl) URL.revokeObjectURL(cd.previewUrl);
      });
      return INITIAL_STATE;
    });
  }, []);

  const detectedAlbums = state.scannedCDs.filter((cd) => cd.status === 'done' && cd.album);
  const totalTracks = detectedAlbums.reduce((sum, cd) => sum + (cd.album?.tracks.length ?? 0), 0);
  const totalDuration = detectedAlbums.reduce(
    (sum, cd) => sum + (cd.album?.totalDurationSeconds ?? 0),
    0,
  );

  return {
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
  };
}
