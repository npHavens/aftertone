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
    unauthorize: async () => {},
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
          generation: 'test',
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
        json: { outcome: 'needs_review', selected: match, candidates: [match], generation: 'test' },
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

async function signedOutPage(
  handle: (route: Route, path: string, state: SignInState) => Promise<boolean>,
) {
  const context = await newTestContext();
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const state: SignInState = { service: null };
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
  return { page, context };
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
  const { page, context } = await signedOutPage(spotifyReturn('connected=spotify'));
  try {
    await page.getByRole('button', { name: 'Connect Spotify' }).click();
    await page.getByText("You're connected to Spotify.", { exact: false }).waitFor();
    assert.match(page.url(), /connected=spotify/);
  } finally {
    await context.close();
  }
});

test('a cancelled Spotify connection explains what happened', async () => {
  const { page, context } = await signedOutPage(spotifyReturn('connection=cancelled'));
  try {
    await page.getByRole('button', { name: 'Connect Spotify' }).click();
    await page.getByRole('alert').filter({ hasText: 'Connection was cancelled.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Connect Spotify' }).isEnabled(), true);
  } finally {
    await context.close();
  }
});

test('apple-music: connecting hands the MusicKit token to the server', async () => {
  let grant: unknown = null;
  let csrfHeader: string | undefined;
  const { page, context } = await signedOutPage(async (route, path, state) => {
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
