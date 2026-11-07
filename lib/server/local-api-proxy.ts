// Intentionally restricted to local development. This is not an open proxy.
const routes: Record<string, RegExp[]> = {
  GET: [
    /^session$/,
    /^auth\/spotify\/(login|callback)$/,
    /^auth\/apple\/developer-token$/,
    /^albums\/search$/,
    /^albums\/[A-Za-z0-9_-]+$/,
    /^playlist-operations\/[A-Za-z0-9_-]+$/,
  ],
  POST: [/^auth\/apple\/session$/, /^recognize$/, /^playlists$/],
  DELETE: [/^session$/],
};

const maxBodyBytes = 10 * 1024 * 1024 + 64 * 1024;

function error(code: string, message: string, status: number, retryable = false) {
  return Response.json(
    { code, message, retryable },
    {
      status,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export async function proxyLocalApi(
  request: Request,
  path: string[],
  backendOrigin = process.env.AFTERTONE_BACKEND_ORIGIN ?? 'http://127.0.0.1:8000',
  upstreamFetch: typeof fetch = fetch,
) {
  const route = path.join('/');
  if (!routes[request.method]?.some((pattern) => pattern.test(route))) {
    return error('NOT_FOUND', 'This API route is not available.', 404);
  }
  let origin: URL;
  try {
    origin = new URL(backendOrigin);
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) ||
      origin.protocol !== 'http:' ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      throw new Error();
  } catch {
    return error('LOCAL_CONFIG_INVALID', 'Configure a loopback HTTP backend origin.', 503);
  }
  const target = new URL(`/api/${route}`, origin);
  target.search = new URL(request.url).search;
  const headers = new Headers();
  for (const name of [
    'accept',
    'content-type',
    'cookie',
    'origin',
    'x-csrf-token',
    'idempotency-key',
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  let body: Uint8Array | undefined;
  if (request.method === 'POST' && request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBodyBytes) {
          await reader.cancel();
          return error('UPLOAD_TOO_LARGE', 'Choose an image smaller than 10 MB.', 413);
        }
        chunks.push(value);
      }
    } catch {
      return error('REQUEST_INTERRUPTED', 'The upload was interrupted. Try again.', 400, true);
    }
    body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
  }
  try {
    const result = await upstreamFetch(target, {
      method: request.method,
      headers,
      body: body as BodyInit | undefined,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
    });
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'location', 'retry-after']) {
      const value = result.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    for (const cookie of result.headers.getSetCookie())
      responseHeaders.append('set-cookie', cookie);
    return new Response(result.body, { status: result.status, headers: responseHeaders });
  } catch {
    return error(
      'BACKEND_UNAVAILABLE',
      'The local backend is not responding. Start it on port 8000 and try again.',
      503,
      true,
    );
  }
}
