import type { PlaylistOperation } from '../types/index.ts';

export const publishStorageKey = 'aftertone.pending-publish.v1';
export interface PendingPublish {
  scope: string;
  key: string;
  body: string;
  operation: PlaylistOperation | null;
}

export function definitiveRejection(status: number, previouslyUncertain: boolean): boolean {
  return (
    !previouslyUncertain &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 409 &&
    status !== 410
  );
}

export function readPlaylistOperation(value: unknown): PlaylistOperation | null {
  if (!value || typeof value !== 'object') return null;
  const operation = value as Record<string, unknown>;
  if (
    typeof operation.id !== 'string' ||
    !operation.id ||
    typeof operation.status !== 'string' ||
    !['processing', 'completed', 'failed', 'needs_attention'].includes(operation.status) ||
    typeof operation.addedCount !== 'number' ||
    !Number.isInteger(operation.addedCount) ||
    operation.addedCount < 0 ||
    ['playlistId', 'playlistUrl', 'message'].some(
      (key) => operation[key] != null && typeof operation[key] !== 'string',
    )
  )
    return null;
  return value as PlaylistOperation;
}

export function readPendingPublish(raw: string | null, scope: string): PendingPublish | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PendingPublish;
    if (
      value.scope !== scope ||
      typeof value.key !== 'string' ||
      !value.key ||
      typeof value.body !== 'string'
    )
      return null;
    const body = JSON.parse(value.body);
    if (
      typeof body.name !== 'string' ||
      !Array.isArray(body.trackIds) ||
      !body.trackIds.every((id: unknown) => typeof id === 'string')
    )
      return null;
    return {
      scope,
      key: value.key,
      body: value.body,
      operation: readPlaylistOperation(value.operation),
    };
  } catch {
    return null;
  }
}
