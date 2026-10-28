# Aftertone local progress

Updated October 25, 2026. Work remains local, with no deployment or cloud provisioning.

## Implemented

- Approved warm retro UI with blocky typography, responsive layout and seven Figma concepts.
- ESLint, Prettier, Ruff and VS Code formatting/safe fixes on save.
- Local Next.js gateway and FastAPI backend with encrypted SQLite sessions, Spotify PKCE and Apple MusicKit integration paths.
- Photo recognition queue, retry, manual catalog correction, album ordering and track-level exclusions. Selected tracks retain album order and deduplicate canonical IDs; publishing accepts 1–500 tracks.
- Playlist publishing with durable local idempotency records. The browser retains the exact pending request across reloads using session-scoped storage, without storing tokens or uploaded photos.
- Bounded status polling, editable drafts after definite failures, and explicit review of uncertain/partial writes before starting another mix. Uncertain provider writes are never automatically replayed.
- Regression coverage for provider paging, refresh/session expiry, canonical validation, partial writes and browser recovery flows.

## Account setup needed for live acceptance testing

These do not block local development. No live provider authorization or playlist creation has been verified. Vertex recognition was verified once, as described below.

- **Spotify:** local developer app/client ID and registered callback matching `backend/.env.example`; account access for authorization and a deliberate test playlist.
- **Apple Music:** MusicKit developer signing key, team ID and key ID, plus browser authorization with the subscription account. A music subscription alone does not supply developer signing credentials.
- **Gemini (verified October 25, 2026):** `gemini-4-argon` on `global` in `nhs-aftertone`, with local ADC as `nick@nohandstack.com` and `GOOGLE_CLOUD_QUOTA_PROJECT=nhs-aftertone`. Ownership, billing and API access were checked. One live request in the backend's recognition request shape identified a synthetic album cover. The `/api/recognize` route itself has not been exercised live, because it needs a connected provider.
- **Session encryption:** persistent local `TOKEN_ENCRYPTION_KEY` before connecting providers. Keep all values in ignored local configuration.

See [backend setup](../backend/README.md) for configuration and [the project README](../README.md) for commands.

## Known limits and follow-up

- Local publishing uses one backend worker. It has no distributed queue or automatic reconciliation of uncertain writes.
- Publish records outlive their session, so an unknown outcome can always be re-checked while signed in. It stays frozen in the browser until checked or acknowledged; inspect the provider library before attempting a new playlist. Recovery across expired authorization needs further product work.
- The current Next.js 16.2.6 dependency advisories need a separate, tested framework upgrade. ESLint stays on version 9 until the React/accessibility plugins support version 10.
- AI-generated playlists remain a future feature. Final vector/monochrome logo assets remain brand follow-up work.

## Local verification

Latest checks: ESLint/Prettier/TypeScript and 18 frontend unit tests pass; Ruff and 51 backend tests pass; the local production build passes. Thirteen fixture browser tests cover signed-out Spotify and Apple Music connection (including a cancelled Spotify sign-in), both provider result formats, scan retry, correction, exclusions, polling, reload recovery and mobile layout. Backend tests cover the Spotify callback, Apple session creation and the recognition endpoint with a fake Gemini client. Upstream Python deprecation warnings and the Node test module-type warning remain.

Run `npm run check`, `npm run check:backend`, and `npm run build`. For browser regressions, run the frontend at `http://127.0.0.1:3000` and then `npm run test:browser` (or set `AFTERTONE_TEST_ORIGIN`). Install Playwright Chromium if absent with `npx playwright install chromium`.

Browser tests intercept every API request with fixtures and cannot create real playlists. Backend tests use temporary databases and mocked HTTP responses. These checks verify application behavior, not live account access.
