import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';

const origin = process.env.AFTERTONE_TEST_ORIGIN ?? 'http://127.0.0.1:3000';
const photo = {
  name: 'cover.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=',
    'base64',
  ),
};

let browser: Browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

function album(service = 'spotify') {
  return {
    id: 'album1',
    service,
    title: 'Test album',
    artist: 'Test artist',
    artworkUrl: null,
    url:
      service === 'spotify'
        ? 'https://open.spotify.com/album/album1'
        : 'https://music.apple.com/us/album/album1',
    tracks: [
      { id: 'track1', title: 'First song', artist: 'Test artist', durationMs: 181000, url: null },
    ],
  };
}

// Stands in for Apple's MusicKit script, so tests never load it from Apple's CDN.
const musicKitStub = `
window.MusicKit = {
  configure: async (config) => { window.musicKitConfig = config; },
  getInstance: () => ({
    authorize: async () => 'test-music-user-token',
    unauthorize: async () => {
      if (window.failMusicKitSignOut) throw new Error('MusicKit sign-out failed');
    },
  }),
};`;
const developerTokenConfig = {
  developerToken: 'test-developer-token',
  app: { name: 'Aftertone', build: '1' },
};

async function newTestContext(): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.route('https://js-cdn.music.apple.com/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: musicKitStub }),
  );
  return context;
}

function sessionJson(service: string | null) {
  return {
    authenticated: !!service,
    service,
    sessionScope: 'test-session',
    csrfToken: 'test-csrf',
    capabilities: { spotify: true, appleMusic: true, recognition: true },
    setupRequired: [],
  };
}

async function fixturePage(
  overrides: (route: Route, path: string) => Promise<boolean>,
  service = 'spotify',
) {
  const context = await newTestContext();
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  // All API traffic is intercepted. These tests cannot write to a user's music account.
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (await overrides(route, path)) return;
    if (path === '/api/session') {
      await route.fulfill({ json: sessionJson(service) });
    } else if (path === '/api/auth/apple/developer-token') {
      await route.fulfill({ json: developerTokenConfig });
    } else if (path === '/api/recognize') {
      await route.fulfill({
        json: {
          outcome: 'needs_review',
          selected: album(service),
          candidates: [album(service)],
          evidence: 'Review this match.',
        },
      });
    } else if (path === '/api/albums/search') {
      await route.fulfill({ json: { albums: [album(service)] } });
    } else if (path === '/api/albums/album1') {
      await route.fulfill({ json: album(service) });
    } else {
      await route.fulfill({
        status: 500,
        json: { code: 'unexpected_test_request', message: path },
      });
    }
  });
  await page.goto(origin);
  await page
    .getByText(`You're connected to ${service === 'spotify' ? 'Spotify' : 'Apple Music'}.`, {
      exact: false,
    })
    .waitFor();
  return { page, context };
}

async function confirmPhoto(page: Page) {
  await page.locator('input[type=file]').setInputFiles(photo);
  await page.getByRole('button', { name: 'Confirm album', exact: true }).click();
}

test('failed recognition retries the same photo and displays reviewable tracks', async () => {
  let scans = 0;
  const { page, context } = await fixturePage(async (route, path) => {
    if (path !== '/api/recognize') return false;
    scans += 1;
    if (scans > 1) return false;
    await route.fulfill({
      status: 502,
      json: { code: 'recognition_unavailable', message: 'Recognition temporarily unavailable.' },
    });
    return true;
  });
  try {
    await page.locator('input[type=file]').setInputFiles(photo);
    await page.getByRole('button', { name: 'Retry recognition' }).click();
    await page.getByRole('button', { name: 'Confirm album', exact: true }).click();
    await page.getByText('View tracks', { exact: true }).click();
    await page.getByText('First song', { exact: true }).waitFor();
    assert.equal(scans, 2);
    assert.equal(await page.locator('.album-review').count(), 1);
  } finally {
    await context.close();
  }
});

test('correction searches while typing and Escape restores focus', async () => {
  const { page, context } = await fixturePage(async () => false);
  try {
    await confirmPhoto(page);
    await page.getByRole('button', { name: 'Find another match' }).click();
    await page.getByLabel('Artist or album title').fill('Test artist');
    await page
      .getByRole('button', { name: 'Choose Test album by Test artist', exact: true })
      .waitFor();
    await page.getByLabel('Artist or album title').press('Escape');
    await page.getByRole('button', { name: 'Close search' }).waitFor({ state: 'hidden' });
    assert.equal(
      await page
        .getByRole('button', { name: 'Find another match' })
        .evaluate((el) => el === document.activeElement),
      true,
    );
  } finally {
    await context.close();
  }
});

for (const service of ['spotify', 'apple-music']) {
  test(`${service}: confirmed album publishes canonical IDs and opens the correct service`, async () => {
    let publishes = 0;
    const { page, context } = await fixturePage(async (route, path) => {
      if (path !== '/api/playlists') return false;
      publishes += 1;
      assert.deepEqual(route.request().postDataJSON().trackIds, ['track1']);
      assert.equal(route.request().headers()['x-csrf-token'], 'test-csrf');
      assert.ok(route.request().headers()['idempotency-key']);
      await route.fulfill({
        json: {
          id: 'op1',
          status: 'completed',
          addedCount: 1,
          playlistUrl:
            service === 'spotify'
              ? 'https://open.spotify.com/playlist/p1'
              : 'https://music.apple.com/us/playlist/p1',
        },
      });
      return true;
    }, service);
    try {
      await confirmPhoto(page);
      await page.getByRole('button', { name: 'Make my playlist' }).click();
      await page.getByRole('heading', { name: 'Back in rotation.' }).waitFor();
      await page
        .getByRole('link', {
          name: `Open in ${service === 'spotify' ? 'Spotify' : 'Apple Music'}`,
          exact: false,
        })
        .waitFor();
      assert.equal(publishes, 1);
    } finally {
      await context.close();
    }
  });
}

test('a lost publish response survives reload and reuses the exact request key', async () => {
  const requests: { key: string; body: string }[] = [];
  const { page, context } = await fixturePage(async (route, path) => {
    if (path !== '/api/playlists') return false;
    requests.push({
      key: route.request().headers()['idempotency-key'],
      body: route.request().postData() || '',
    });
    if (requests.length === 1) await route.abort('connectionfailed');
    else await route.fulfill({ json: { id: 'recovered-op', status: 'completed', addedCount: 1 } });
    return true;
  });
  try {
    await confirmPhoto(page);
    await page.getByRole('button', { name: 'Make my playlist' }).click();
    await page.getByRole('button', { name: 'Check same request' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Check same request' }).click();
    await page.getByRole('heading', { name: 'Back in rotation.' }).waitFor();
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    const stored = await page.evaluate(() => JSON.stringify(sessionStorage));
    assert.ok(!stored.includes('test-csrf'));
    assert.ok(!stored.includes('cover.png'));
  } finally {
    await context.close();
  }
});

test('a definitive validation rejection keeps the draft editable', async () => {
  const { page, context } = await fixturePage(async (route, path) => {
    if (path !== '/api/playlists') return false;
    await route.fulfill({
      status: 422,
      json: { code: 'invalid_request', message: 'Choose a shorter playlist name.' },
    });
    return true;
  });
  try {
    await confirmPhoto(page);
    await page.getByRole('button', { name: 'Make my playlist' }).click();
    await page.getByText('Your draft is ready to edit.', { exact: false }).waitFor();
    await page.getByLabel('Playlist name').fill('Fixed playlist');
    assert.equal(await page.getByRole('button', { name: 'Make my playlist' }).isEnabled(), true);
    assert.equal(await page.locator('.album-review').count(), 1);
  } finally {
    await context.close();
  }
});

test('track exclusions affect publishing and choosing another match resets them', async () => {
  const { page, context } = await fixturePage(async () => false);
  try {
    await confirmPhoto(page);
    await page.getByText('View tracks', { exact: true }).click();
    await page.getByRole('checkbox', { name: 'Include First song' }).uncheck();
    assert.equal(await page.getByRole('button', { name: 'Make my playlist' }).isDisabled(), true);
    await page.getByText('0 of 1 tracks selected', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Find another match' }).click();
    await page.getByLabel('Artist or album title').fill('Test artist');
    await page.getByRole('button', { name: 'Choose Test album by Test artist' }).click();
    await page.getByRole('button', { name: 'Close search' }).waitFor({ state: 'hidden' });
    assert.equal(
      await page.getByRole('checkbox', { name: 'Include First song' }).isChecked(),
      true,
    );
    assert.equal(await page.getByRole('button', { name: 'Make my playlist' }).isEnabled(), true);
  } finally {
    await context.close();
  }
});

test('processing polls the existing operation without another playlist submission', async () => {
  let publishes = 0;
  let checks = 0;
  const { page, context } = await fixturePage(async (route, path) => {
    if (path === '/api/playlists') {
      publishes += 1;
      await route.fulfill({ json: { id: 'pending-op', status: 'processing', addedCount: 0 } });
      return true;
    }
    if (path === '/api/playlist-operations/pending-op') {
      checks += 1;
      await route.fulfill({ json: { id: 'pending-op', status: 'completed', addedCount: 1 } });
      return true;
    }
    return false;
  });
  try {
    await confirmPhoto(page);
    await page.getByRole('button', { name: 'Make my playlist' }).click();
    await page.getByRole('heading', { name: 'Back in rotation.' }).waitFor();
    assert.equal(publishes, 1);
    assert.equal(checks, 1);
  } finally {
    await context.close();
  }
});

test('a definite operation failure allows editing without discarding the draft', async () => {
  const { page, context } = await fixturePage(async (route, path) => {
    if (path !== '/api/playlists') return false;
    await route.fulfill({ json: { id: 'failed-op', status: 'failed', addedCount: 0 } });
    return true;
  });
  try {
    await confirmPhoto(page);
    await page.getByLabel('Playlist name').fill('Evening favorites');
    await page.getByRole('button', { name: 'Make my playlist' }).click();
    await page.getByRole('button', { name: 'Edit this mix' }).click();
    assert.equal(await page.getByLabel('Playlist name').inputValue(), 'Evening favorites');
    assert.equal(await page.locator('.album-review').count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Make my playlist' }).isEnabled(), true);
  } finally {
    await context.close();
  }
});

test('mobile track selection submits only included tracks without horizontal overflow', async () => {
  let selected: string[] = [];
  const { page, context } = await fixturePage(async (route, path) => {
    if (path === '/api/recognize') {
      const match = album();
      match.tracks.push({
        id: 'track2',
        title: 'Second song',
        artist: 'Test artist',
        durationMs: 200000,
        url: null,
      });
      await route.fulfill({
        json: { outcome: 'needs_review', selected: match, candidates: [match] },
      });
      return true;
    }
    if (path === '/api/playlists') {
      selected = route.request().postDataJSON().trackIds;
      await route.fulfill({ json: { id: 'selected-op', status: 'completed', addedCount: 1 } });
      return true;
    }
    return false;
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await confirmPhoto(page);
    await page.getByText('View tracks', { exact: true }).click();
    await page.getByRole('checkbox', { name: 'Include Second song' }).uncheck();
    await page.getByText('1 of 2 tracks selected', { exact: false }).waitFor();
    const checkboxSize = await page
      .getByRole('checkbox', { name: 'Include Second song' })
      .boundingBox();
    assert.ok(checkboxSize && checkboxSize.width <= 24 && checkboxSize.height <= 24);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await page.screenshot({
      path: 'test-results/aftertone-track-selection-mobile.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Make my playlist' }).click();
    await page.getByRole('heading', { name: 'Back in rotation.' }).waitFor();
    assert.deepEqual(selected, ['track1']);
  } finally {
    await context.close();
  }
});

type SignInState = { service: string | null };

// The session can change mid-test, so connection flows start signed out (or as a given service).
async function connectionPage(
  handle: (route: Route, path: string, state: SignInState) => Promise<boolean>,
  initialService: string | null = null,
) {
  const context = await newTestContext();
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const state: SignInState = { service: initialService };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (await handle(route, path, state)) return;
    if (path === '/api/session') {
      await route.fulfill({ json: sessionJson(state.service) });
    } else if (path === '/api/auth/apple/developer-token') {
      await route.fulfill({ json: developerTokenConfig });
    } else {
      await route.fulfill({
        status: 500,
        json: { code: 'unexpected_test_request', message: path },
      });
    }
  });
  await page.goto(origin);
  await waitForSessionLoaded(page);
  return { page, context };
}

// The Connect buttons stay disabled until the page's session request settles.
async function waitForSessionLoaded(page: Page) {
  await page.getByRole('status').filter({ hasText: 'Checking your connection' }).waitFor({
    state: 'hidden',
  });
}

function spotifyReturn(outcome: string) {
  return async (route: Route, path: string, state: SignInState) => {
    if (path !== '/api/auth/spotify/login') return false;
    if (outcome === 'connected=spotify') state.service = 'spotify';
    await route.fulfill({ status: 302, headers: { location: `${origin}/?${outcome}` } });
    return true;
  };
}

test('spotify: connecting from a signed-out session returns to the connected app', async () => {
  const { page, context } = await connectionPage(spotifyReturn('connected=spotify'));
  try {
    await page.getByRole('button', { name: 'Connect Spotify' }).click();
    await page.getByText("You're connected to Spotify.", { exact: false }).waitFor();
    assert.match(page.url(), /connected=spotify/);
  } finally {
    await context.close();
  }
});

test('a cancelled Spotify connection explains what happened once', async () => {
  const { page, context } = await connectionPage(spotifyReturn('connection=cancelled'));
  try {
    await page.getByRole('button', { name: 'Connect Spotify' }).click();
    const notice = page.getByRole('alert').filter({ hasText: 'Connection was cancelled.' });
    await notice.waitFor();
    await waitForSessionLoaded(page);
    await page.getByRole('button', { name: 'Connect Spotify', disabled: false }).waitFor();
    await page.waitForFunction(() => !new URLSearchParams(location.search).has('connection'));
    await page.reload();
    await waitForSessionLoaded(page);
    assert.equal(await notice.count(), 0);
  } finally {
    await context.close();
  }
});

test('a connection notice clears once another service connects', async () => {
  const cancelSpotify = spotifyReturn('connection=cancelled');
  const { page, context } = await connectionPage(async (route, path, state) => {
    if (await cancelSpotify(route, path, state)) return true;
    if (path !== '/api/auth/apple/session') return false;
    state.service = 'apple-music';
    await route.fulfill({ json: { authenticated: true, service: 'apple-music' } });
    return true;
  });
  try {
    await page.getByRole('button', { name: 'Connect Spotify' }).click();
    const notice = page.getByRole('alert').filter({ hasText: 'Connection was cancelled.' });
    await notice.waitFor();
    await waitForSessionLoaded(page);
    await page.getByRole('button', { name: 'Connect Apple Music' }).click();
    await page.getByText("You're connected to Apple Music.", { exact: false }).waitFor();
    await notice.waitFor({ state: 'hidden' });
  } finally {
    await context.close();
  }
});

// A 204 keeps the browser on this page, as if it had left for Spotify's sign-in. The test then
// returns with Back, optionally after signing in there.
function backFromSpotify(signedIn: boolean) {
  return async (route: Route, path: string, state: SignInState) => {
    if (path !== '/api/auth/spotify/login') return false;
    if (signedIn) state.service = 'spotify';
    await route.fulfill({ status: 204 });
    return true;
  };
}

// Playwright's Chromium never restores pages from that cache, so send the event it would fire.
async function restoreFromBackForwardCache(page: Page) {
  await page.getByRole('button', { name: 'Connect Spotify', disabled: true }).waitFor();
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
}

test('a page restored from the back/forward cache re-enables the Connect buttons', async () => {
  const { page, context } = await connectionPage(backFromSpotify(false));
  try {
    await page.getByRole('button', { name: 'Connect Spotify' }).click();
    await restoreFromBackForwardCache(page);
    await page.getByRole('button', { name: 'Connect Spotify', disabled: false }).waitFor();
  } finally {
    await context.close();
  }
});

test('a page restored from the back/forward cache shows a sign-in finished meanwhile', async () => {
  const { page, context } = await connectionPage(backFromSpotify(true));
  try {
    await page.getByRole('button', { name: 'Connect Spotify' }).click();
    await restoreFromBackForwardCache(page);
    await page.getByText("You're connected to Spotify.", { exact: false }).waitFor();
  } finally {
    await context.close();
  }
});

test('apple-music: connecting hands the MusicKit token to the server', async () => {
  let grant: unknown = null;
  let csrfHeader: string | undefined;
  const { page, context } = await connectionPage(async (route, path, state) => {
    if (path !== '/api/auth/apple/session') return false;
    grant = route.request().postDataJSON();
    csrfHeader = route.request().headers()['x-csrf-token'];
    state.service = 'apple-music';
    await route.fulfill({ json: { authenticated: true, service: 'apple-music' } });
    return true;
  });
  try {
    await page.getByRole('button', { name: 'Connect Apple Music' }).click();
    await page.getByText("You're connected to Apple Music.", { exact: false }).waitFor();
    assert.deepEqual(grant, { musicUserToken: 'test-music-user-token' });
    assert.equal(csrfHeader, 'test-csrf');
    const configured = await page.evaluate(
      () => (window as unknown as { musicKitConfig: unknown }).musicKitConfig,
    );
    assert.deepEqual(configured, developerTokenConfig);
  } finally {
    await context.close();
  }
});

test('apple-music: disconnecting still signs out when MusicKit sign-out fails', async () => {
  const { page, context } = await connectionPage(async (route, path, state) => {
    if (path !== '/api/session' || route.request().method() !== 'DELETE') return false;
    state.service = null;
    await route.fulfill({ json: { disconnected: true } });
    return true;
  }, 'apple-music');
  try {
    await page.getByText("You're connected to Apple Music.", { exact: false }).waitFor();
    await page.waitForFunction(() => 'musicKitConfig' in window);
    await page.evaluate(() => {
      (window as unknown as { failMusicKitSignOut: boolean }).failMusicKitSignOut = true;
    });
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await page.getByRole('button', { name: 'Connect Apple Music' }).waitFor();
    await page.getByText('Apple Music did not finish signing out', { exact: false }).waitFor();
  } finally {
    await context.close();
  }
});

test('alternatives from the photo are offered when the top match did not load', async () => {
  const { page, context } = await fixturePage(async (route, path) => {
    if (path !== '/api/recognize') return false;
    await route.fulfill({
      json: {
        outcome: 'needs_review',
        selected: null,
        candidates: [album()],
        evidence: 'Test artist — Test album',
      },
    });
    return true;
  });
  try {
    await page.locator('input[type=file]').setInputFiles(photo);
    await page.getByRole('button', { name: 'Choose a match' }).click();
    await page.getByText('1 possible match from your photo.', { exact: false }).waitFor();
    await page
      .getByRole('button', { name: 'Choose Test album by Test artist', exact: true })
      .click();
    await page.getByText('View tracks', { exact: true }).waitFor();
  } finally {
    await context.close();
  }
});

test('a publish the server can no longer report can be acknowledged', async () => {
  let attempts = 0;
  const { page, context } = await fixturePage(async (route, path) => {
    if (path !== '/api/playlists') return false;
    attempts += 1;
    if (attempts === 1) await route.abort('connectionfailed');
    else
      await route.fulfill({
        status: 410,
        json: { code: 'operation_expired', message: 'This publish record expired.' },
      });
    return true;
  });
  try {
    await confirmPhoto(page);
    await page.getByRole('button', { name: 'Make my playlist' }).click();
    await page.getByRole('button', { name: 'Check same request' }).click();
    await page.getByText('This publish can no longer be checked.', { exact: false }).waitFor();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'I’ve checked — start a new mix' }).click();
    await page.getByRole('button', { name: 'Choose photos' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Choose photos' }).isEnabled(), true);
    assert.equal(attempts, 2);
  } finally {
    await context.close();
  }
});

test('disconnecting after the session expired returns to signed out', async () => {
  const { page, context } = await connectionPage(async (route, path, state) => {
    if (path !== '/api/session' || route.request().method() !== 'DELETE') return false;
    state.service = null;
    await route.fulfill({
      status: 401,
      json: {
        code: 'unauthenticated',
        message: 'Your session expired. Reconnect your music service.',
      },
    });
    return true;
  }, 'spotify');
  try {
    await page.getByText("You're connected to Spotify.", { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await page.getByRole('button', { name: 'Connect Spotify' }).waitFor();
  } finally {
    await context.close();
  }
});

test('an older session check never replaces a newer one', async () => {
  const held: Route[] = [];
  let checks = 0;
  const { page, context } = await connectionPage(async (route, path, state) => {
    if (path !== '/api/session') return false;
    if (route.request().method() === 'DELETE') {
      state.service = null;
      await route.fulfill({ json: { disconnected: true } });
      return true;
    }
    checks += 1;
    if (checks === 2) {
      await route.fulfill({
        status: 503,
        json: { code: 'unavailable', message: 'The connection check failed.' },
      });
      return true;
    }
    if (checks === 3) {
      held.push(route);
      return true;
    }
    return false;
  }, 'spotify');
  try {
    // A failed check after disconnecting keeps the signed-in page and offers a retry, so retrying
    // and then disconnecting again runs two checks at once.
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await page.getByRole('button', { name: 'Retry connection check' }).click();
    await until(() => held.length === 1);
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await page.getByRole('button', { name: 'Connect Spotify' }).waitFor();
    await release(held, sessionJson('spotify'));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    assert.equal(await page.getByText("You're connected to Spotify.", { exact: false }).count(), 0);
  } finally {
    await context.close();
  }
});

test('a known operation the server no longer has can be acknowledged', async () => {
  let publishes = 0;
  const { page, context } = await fixturePage(async (route, path) => {
    if (path === '/api/playlists') {
      publishes += 1;
      await route.fulfill({ json: { id: 'gone-op', status: 'processing', addedCount: 0 } });
      return true;
    }
    if (path === '/api/playlist-operations/gone-op') {
      await route.fulfill({
        status: 404,
        json: { code: 'not_found', message: 'Publish operation not found.' },
      });
      return true;
    }
    return false;
  });
  try {
    await confirmPhoto(page);
    await page.getByRole('button', { name: 'Make my playlist' }).click();
    await page.getByText('This publish can no longer be checked.', { exact: false }).waitFor();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'I’ve checked — start a new mix' }).click();
    await page.getByRole('button', { name: 'Choose photos' }).waitFor();
    assert.equal(publishes, 1);
  } finally {
    await context.close();
  }
});

// Responses held until the test releases them, to simulate slow requests.
async function release(held: Route[], result: unknown) {
  for (const route of held.splice(0)) {
    // A request the page already aborted can't be fulfilled; that is the point of the test.
    await route.fulfill({ json: result }).catch(() => {});
  }
}

async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 100 && !condition(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(condition());
}

function recognized(match = album()) {
  return { outcome: 'needs_review', selected: match, candidates: [match], evidence: 'Match' };
}

test('a late recognition result never restores a removed photo, and queued photos continue', async () => {
  const held: Route[] = [];
  const { page, context } = await fixturePage(async (route, path) => {
    if (path !== '/api/recognize') return false;
    held.push(route);
    return true;
  });
  try {
    const photos = ['one.png', 'two.png', 'three.png'].map((name) => ({ ...photo, name }));
    await page.locator('input[type=file]').setInputFiles(photos);
    await until(() => held.length === 2);
    await page.locator('.album-review').first().getByRole('button', { name: 'Remove' }).click();
    await until(() => held.length === 3);
    await release(held, recognized());
    await page.getByText('Your review needed').nth(1).waitFor();
    assert.equal(await page.locator('.album-review').count(), 2);
  } finally {
    await context.close();
  }
});

test('a late recognition result never replaces a match chosen by hand', async () => {
  const held: Route[] = [];
  const { page, context } = await fixturePage(async (route, path) => {
    if (path !== '/api/recognize') return false;
    held.push(route);
    return true;
  });
  try {
    await page.locator('input[type=file]').setInputFiles(photo);
    await until(() => held.length === 1);
    await page.getByRole('button', { name: 'Choose a match' }).click();
    await page.getByLabel('Artist or album title').fill('Test artist');
    await page
      .getByRole('button', { name: 'Choose Test album by Test artist', exact: true })
      .click();
    await page.getByText('Added to your mix').waitFor();
    await release(held, recognized({ ...album(), id: 'album2', title: 'Wrong album' }));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    assert.equal(await page.getByText('Wrong album').count(), 0);
    assert.equal(await page.getByText('Added to your mix').count(), 1);
  } finally {
    await context.close();
  }
});

test('a late recognition result never returns after disconnecting', async () => {
  const held: Route[] = [];
  const { page, context } = await connectionPage(async (route, path, state) => {
    if (path === '/api/recognize') {
      held.push(route);
      return true;
    }
    if (path !== '/api/session' || route.request().method() !== 'DELETE') return false;
    state.service = null;
    await route.fulfill({ json: { disconnected: true } });
    return true;
  }, 'spotify');
  try {
    await page.getByText("You're connected to Spotify.", { exact: false }).waitFor();
    await page.locator('input[type=file]').setInputFiles(photo);
    await until(() => held.length === 1);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await page.getByRole('button', { name: 'Connect Spotify' }).waitFor();
    await release(held, recognized());
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    assert.equal(await page.locator('.album-review').count(), 0);
  } finally {
    await context.close();
  }
});
