export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}, csrf?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (csrf) headers.set('X-CSRF-Token', csrf);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      body?.message || 'The connection could not be completed. Please try again.',
      response.status,
      body?.code || 'connection_error',
    );
  return body as T;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
export function serviceLink(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      ['open.spotify.com', 'music.apple.com'].includes(parsed.hostname)
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}
