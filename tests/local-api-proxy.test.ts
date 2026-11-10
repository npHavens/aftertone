import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyLocalApi } from '../lib/server/local-api-proxy.ts';

test('rejects unlisted paths and non-local upstreams without fetching', async () => {
  const neverFetch = (() => {
    throw new Error('must not fetch');
  }) as typeof fetch;
  const request = new Request('http://127.0.0.1:3000/api/session');
  assert.equal((await proxyLocalApi(request, ['admin'], undefined, neverFetch)).status, 404);
  assert.equal(
    (await proxyLocalApi(request, ['session'], 'https://example.com', neverFetch)).status,
    503,
  );
});

test('preserves OAuth redirects and separate cookies without following the redirect', async () => {
  const upstream = (async (_url, init) => {
    assert.equal(init?.redirect, 'manual');
    const h = new Headers({ Location: 'https://accounts.spotify.com/authorize' });
    h.append('set-cookie', 'session=opaque; HttpOnly');
    h.append('set-cookie', 'state=nonce; HttpOnly');
    return new Response(null, { status: 302, headers: h });
  }) as typeof fetch;
  const result = await proxyLocalApi(
    new Request('http://127.0.0.1:3000/api/auth/spotify/login'),
    ['auth', 'spotify', 'login'],
    undefined,
    upstream,
  );
  assert.equal(result.status, 302);
  assert.equal(result.headers.getSetCookie().length, 2);
  assert.equal(result.headers.get('cache-control'), 'no-store');
});

test('forwards multipart bytes, CSRF and session headers but not arbitrary headers', async () => {
  const upstream = (async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('cookie'), 'session=opaque');
    assert.equal(headers.get('x-csrf-token'), 'csrf');
    assert.equal(headers.get('x-arbitrary'), null);
    assert.equal(new TextDecoder().decode(init?.body as Uint8Array), 'image payload');
    return Response.json({ outcome: 'unrecognized' });
  }) as typeof fetch;
  const request = new Request('http://127.0.0.1:3000/api/recognize', {
    method: 'POST',
    body: 'image payload',
    headers: { cookie: 'session=opaque', 'x-csrf-token': 'csrf', 'x-arbitrary': 'drop' },
  });
  assert.equal((await proxyLocalApi(request, ['recognize'], undefined, upstream)).status, 200);
});

test('reports backend downtime as a retryable setup state', async () => {
  const upstream = (async () => {
    throw new Error('connection refused');
  }) as typeof fetch;
  const result = await proxyLocalApi(
    new Request('http://127.0.0.1:3000/api/session'),
    ['session'],
    undefined,
    upstream,
  );
  assert.equal(result.status, 503);
  assert.equal((await result.json()).code, 'BACKEND_UNAVAILABLE');
});

test('sends Spotify sign-in failures back to the app instead of showing JSON', async () => {
  const backendDown = (async () => {
    throw new Error('connection refused');
  }) as typeof fetch;
  const backendCrashed = (async () =>
    new Response('Internal Server Error', { status: 500 })) as typeof fetch;
  const failures: [string[], string | undefined, typeof fetch, string][] = [
    [['auth', 'spotify', 'login'], undefined, backendDown, 'unavailable'],
    [['auth', 'spotify', 'login'], undefined, backendCrashed, 'unavailable'],
    [['auth', 'spotify', 'login'], 'https://example.com', backendDown, 'setup'],
    [['auth', 'spotify', 'callback'], undefined, backendDown, 'unavailable'],
  ];
  for (const [path, backendOrigin, upstream, outcome] of failures) {
    const request = new Request(`http://127.0.0.1:3000/api/${path.join('/')}`);
    const result = await proxyLocalApi(request, path, backendOrigin, upstream);
    assert.equal(result.status, 303);
    assert.equal(result.headers.get('location'), `/?connection=${outcome}`);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
});
