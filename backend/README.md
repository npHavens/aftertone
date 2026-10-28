# Aftertone local backend

This is a local FastAPI implementation. Nothing is deployed. Provider and Vertex calls require your own configured credentials; missing setup returns errors, never demo results.

From this directory:

```sh
uv sync --python 3.11
cp .env.example .env
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Keep one worker: SQLite and process-local refresh/recognition locks are intended for local development. The frontend gateway runs at `http://127.0.0.1:3000`; use that hostname consistently. Register the exact Spotify callback shown in `.env.example`.

Set `TOKEN_ENCRYPTION_KEY` to a generated Fernet key before connecting a provider. Anonymous sessions use an ephemeral key if absent and expire on restart. Configured provider credentials are encrypted in SQLite; the cookie holds only a random opaque identifier and SQLite holds its hash. HTTP localhost cookies omit Secure deliberately; HTTPS origins enable it. Never commit `.env`, `.local/`, private keys, or databases.

Apple Music requires developer signing credentials, not just a subscription. `APPLE_PRIVATE_KEY_PATH` points to your local MusicKit P8 signing key. The browser obtains a short-lived developer token limited to the app origin and explicitly authorizes MusicKit; it hands the Music User Token to the server through the CSRF-protected endpoint. Server-side Apple Music calls use a separate developer token without an origin claim, and both tokens are reused until shortly before they expire.

Recognition uses ADC, explicit `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, and an exact `GEMINI_MODEL` (currently `gemini-4-argon` on `global` in `nhs-aftertone`). `GOOGLE_CLOUD_QUOTA_PROJECT` keeps quota and billing on the Aftertone project when the ADC quota project points elsewhere. Set `VERTEX_ACCESS_VERIFIED=true` only after verifying ownership, billing, model access and region. There is no default model or alternate provider. The request leaves sampling to the model, as Gemini 3+ models require. Photos are validated and normalized in memory. Catalog results never enter the model prompt.

Publishing validates canonical tracks, deduplicates first occurrences, and persists an operation before provider writes. Track checks run eight at a time; Spotify checks use the user's market (`market=from_token`), because Development Mode has no batch track lookup and omits playability without a market. Reusing an idempotency key returns the same operation; a changed payload conflicts. Writes run within the request, and uncertain writes are never replayed automatically. On restart, interrupted operations become `needs_attention`. Check the provider library before starting another publish after uncertainty. This is a conservative local implementation, not a durable distributed worker or automatic reconciliation system.

`GET /api/session` includes a stable, non-secret `sessionScope` for browser recovery storage. It changes when authorization rotates the session or a session expires. An expired session mutation returns `401 unauthenticated`; provider authorization failures return `401 provider_authorization` so the browser can reconnect.

Publish `failed` means no playlist write succeeded or remains uncertain; its `code` and `message` explain the failure. `needs_attention` preserves the known playlist URL and confirmed `addedCount`, which excludes an uncertain batch. Neither status automatically replays writes. Publish records last at least as long as the owner session, so a live session can always re-check its publish; a record that has expired returns `410 operation_expired` and its key stays blocked. An unexpected error during publishing never leaves an operation `processing`: before any write it is `failed`, after that `needs_attention`. Spotify sign-in always returns to the app, with `?connection=cancelled`, `expired` or `failed` when it does not complete. Database initialization and interrupted-operation recovery run at application startup, not module import.

Tooling:

```sh
uv run ruff check .
uv run ruff format --check .
uv run pytest -q
```

The lockfile pins resolved dependencies. Tests use mocked provider HTTP responses and temporary databases. Live OAuth, MusicKit authorization, Vertex recognition and real playlist creation need deliberate account acceptance testing. No actual playlists were created during implementation.

Provider references: [Spotify PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow), [Spotify 2026 routes](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), [Apple playlist creation](https://developer.apple.com/documentation/applemusicapi/create-a-new-library-playlist), [Google Gen AI SDK](https://googleapis.github.io/python-genai/).
