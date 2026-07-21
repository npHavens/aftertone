# Discify Backend — Design Spec

- **Date:** 2026-07-21
- **Status:** Approved (design). Implementation plan pending.
- **Scope:** The backend that replaces the two mocked seams in the existing front-end prototype.

## 1. Context

Discify is today a front-end-only Next.js 16 / React 19 prototype. Two functions are mocked and are the seams this backend replaces:

- `lib/mock-recognition.ts` — `recognizeCD()` fakes latency and returns a random album from `lib/mock-albums.ts`.
- `createPlaylist` in `hooks/usePlaylist.ts` — a `setTimeout` that flips `isSuccess`.

The recognition endpoint is designed to map 1:1 onto the existing `useCDScanner` concurrency queue (one image per call), so the front-end change is "swap the mock for a `fetch`" plus a new login gate and an override affordance.

## 2. Goals / Non-goals

**Goals (v1):**
- Recognize an album from a photo of a CD and return canonical metadata (title, artist, tracklist, durations, cover art).
- Build a playlist on the user's chosen streaming service — Spotify **or** Apple Music.
- Produce a confidence score per detection and let the user manually override **any** album/artist.
- Cheap, GCP-native, minimal moving parts.

**Non-goals (v1):**
- User accounts, persistence, scan history.
- Agentic / multi-step recognition (confidence-based fallback loops, reverse-image search).
- One user using both services at once.
- Non-CD media (vinyl, cassette).

## 3. Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Recognition method | Vision LLM extracts `{artist, title}`; service catalog is ground truth | OCR falls short on stylized/no-text cover art; LLM recognizes albums by imagery. Never trust the LLM for tracklists/durations. |
| Model | **Gemini 3.1 Flash-Lite** on Vertex, name in env | Cheapest Vertex-native vision option; avoids the Oct 16 2026 retirement of 2.5 Flash-Lite. Env-configurable so a swap is one line. |
| Framework | **None** — FastAPI + `google-genai` SDK | The pipeline is deterministic with a single LLM call. ADK/LangChain add abstraction with no payoff. Revisit only if a fallback/verification loop is added. |
| Hosting | Cloud Run (single deployable) | Scales to zero; cheap; GCP-native. Split services only if scaling demands it. |
| Streaming services | Both, behind a `PlaylistProvider` interface | Requested. One user logs into exactly one service. |
| Auth model | **Login-first** — user picks and authenticates with one service on app load | Makes the chosen service the single source of truth for metadata, search, override, and publishing. Eliminates any cross-service data coupling. |
| Metadata / search source | The **logged-in service's own catalog** | Because login is first, the service is known before the grid renders. No neutral source needed; what the user reviews is what gets published. |
| Persistence | **None** (v1) | Both providers establish the same signed session cookie (Spotify token, or Apple developer + user tokens). Nothing is stored server-side. History/accounts are a later increment. |

## 4. Architecture

One FastAPI application on Cloud Run, with two logical halves.

```
                         ┌──────────────────────────────────────────┐
  Next.js frontend ─────▶│  FastAPI (Cloud Run)                      │
  (login-first)          │                                          │
                         │  Recognition (stateless)                 │
   photo ───────────────┼─▶ google-genai → Gemini 3.1 Flash-Lite   │
                         │      → {artist, title, confidence}       │
                         │      → provider.resolve_album()          │──▶ Spotify / Apple
                         │      → Album + confidence                │     catalog
                         │                                          │
                         │  Catalog + Playlist (via logged-in       │
                         │  PlaylistProvider)                       │
   search / override ────┼─▶ provider.search_albums()               │──▶ Spotify / Apple
   create playlist ──────┼─▶ provider.create_playlist()             │     catalog + library
                         └──────────────────────────────────────────┘
```

- **Recognition** is stateless: image in, `Album` out.
- **Catalog + Playlist** runs through whichever `PlaylistProvider` the user authenticated with.
- The Gemini call is the only LLM call in the system.

## 5. Auth — login-first, one service

The user chooses Apple Music or Spotify on app load and authenticates before uploading photos. This is an intentional **auth wall**: no anonymous preview. It is inherent to the product (a playlist requires a service) and it is what makes the single-source-of-truth model clean.

The two providers have different auth shapes; the interface accommodates both:

| | Spotify | Apple Music |
|---|---|---|
| User grant | Server-side redirect (Authorization Code + PKCE); backend handles callback | Client-side via **MusicKit JS** (`music.authorize()`) in the browser |
| Backend's job | Exchange code, hold token in a signed session cookie | Mint the **developer token** (JWT signed with the `.p8` key, ES256); receive the **user token** from the frontend |
| Credential at publish | Session token | Developer token + user token |
| Catalog search auth | User token (or client credentials) | Developer token + user's storefront (`/v1/me/storefront`) |

After either flow, the credential is placed in a single signed session cookie, so every data endpoint (`/recognize`, `/albums/*`, `/playlist`) authenticates uniformly against "Session." No provider token is persisted server-side — it lives only in the cookie.

## 6. Recognition pipeline

1. Frontend downscales each photo to ≤768px before upload (single 258-token image tile → cheapest + faster; cover still recognizable).
2. `POST /api/recognize` (multipart, one image).
3. `google-genai` calls **Gemini 3.1 Flash-Lite** on Vertex with a **structured-output schema**: `{ artist: string, title: string, modelConfidence: number, isAlbumCover: boolean }`.
4. If `isAlbumCover` is false or `modelConfidence` is very low → return a structured `unrecognized` result (frontend shows its existing error state). No hallucinated album is emitted.
5. `provider.resolve_album(artist, title)` searches the logged-in service's catalog and returns the canonical album (tracklist, durations, cover art).
6. Compute a blended `confidence` (see §8) and return an `Album` in the existing `types/index.ts` shape plus `confidence` and `source`.

Vertex authentication uses the Cloud Run service account via Application Default Credentials — no key file.

## 7. `PlaylistProvider` interface

One interface owns all per-service interaction: auth, catalog search (metadata + override), and publishing.

```python
class PlaylistProvider(Protocol):
    # --- auth ---
    def begin_auth(state: str) -> AuthKickoff       # Spotify: redirect URL | Apple: developer token
    def complete_auth(payload: AuthPayload) -> Session  # Spotify: exchange code | Apple: accept user token

    # --- catalog (metadata + override autocomplete) ---
    def search_albums(query: str, market: str) -> list[Album]
    def resolve_album(artist: str, title: str, market: str) -> Album | None

    # --- publish ---
    def resolve_tracks(album: Album, market: str) -> list[TrackId]
    def create_playlist(name: str, track_ids: list[TrackId]) -> PlaylistResult
```

`SpotifyProvider` and `AppleMusicProvider` implement it.

**Apple Music limitations to design around** (verified against Apple docs + developer forums):
- **Append-only:** tracks can only be added to the end of a library playlist; no reordering. We control order, so build the full ordered list and send once.
- **Batch flakiness:** large adds fail inconsistently. **Chunk** track additions (~100–300 per request) with retries.
- **Async materialization:** a freshly created playlist reads back empty for a few seconds; do not re-fetch immediately to confirm.
- Endpoints: `POST /v1/me/library/playlists`, `POST /v1/me/library/playlists/{id}/tracks`.

`PlaylistResult` includes `playlistUrl`, `addedCount`, and `missed[]` (tracks absent from the target catalog) so the UI can honestly report unavailable tracks.

## 8. Metadata, search, and manual override

Because login is first, **the logged-in service's catalog is the single source** for grid metadata, override autocomplete, track resolution, and publishing. Metadata and publish share the same service and market, so `missed[]` is rare.

**Confidence** is derived from two signals, not the model's word alone:
1. `modelConfidence` — the LLM's self-report (uncalibrated; a relative signal).
2. **Match strength** — did `resolve_album` return a single strong catalog hit, or something ambiguous/empty?

Blend into `confidence` (0–1). Cards below a configurable threshold (default `0.6`) get a "Not sure?" flag.

**Manual override** (any card is editable, not just low-confidence ones):
- `GET /api/albums/search?q=…` → candidate albums from the service catalog (autocomplete).
- `POST /api/albums/resolve` `{artist, title}` or `{albumId}` → canonical `Album`.
- On override, the card is replaced, `source` becomes `manual`, and `confidence` is pinned to `1.0`. The playlist is always built from the final (possibly corrected) set.

**Cover art** comes from the service catalog. Last-resort fallback: the user's uploaded photo.

## 9. API contract

| Method + path | Purpose | Auth |
|---|---|---|
| `GET /api/auth/spotify/login` | Begin Spotify redirect flow | — |
| `GET /api/auth/spotify/callback` | Exchange code → session cookie | — |
| `GET /api/auth/apple/developer-token` | Mint developer token for MusicKit JS | — |
| `POST /api/auth/apple/session` | Accept Apple user token from frontend | Dev token |
| `POST /api/recognize` | One image → `Album` + confidence (or `unrecognized`) | Session |
| `GET /api/albums/search?q=…` | Override autocomplete | Session |
| `POST /api/albums/resolve` | Resolve `{artist,title}`/`{albumId}` → `Album` | Session |
| `POST /api/playlist` | `{name, albums[]}` → create playlist, return `{playlistUrl, addedCount, missed[]}` | Session |

## 10. Data model

Backend returns `Album` in the existing `types/index.ts` shape, extended with:

- `Album.confidence: number` (0–1)
- `ScannedCD.source: 'auto' | 'manual'`

Backend-internal DTOs: `AuthKickoff`, `Session`, `TrackId`, `PlaylistResult`, `RecognitionResult` (`Album | Unrecognized`).

## 11. Error handling

- Low confidence / not an album cover → `unrecognized` (frontend shows existing error state).
- Catalog miss on `resolve_album` → `unrecognized` or partial.
- Unresolvable tracks at publish → returned in `missed[]`, never silently dropped.
- Provider 429 / timeout → retry with backoff; surface as retryable.
- Non-image or oversize upload → `415` / `413`.

## 12. Security & secrets

- Vertex: Cloud Run service-account ADC (no key file).
- Spotify client secret, Apple `.p8` private key (+ key/team IDs) → **Secret Manager**, injected as env.
- Session cookie (either provider): signed, `httpOnly`, short TTL. No server-side token storage.
- CORS restricted to the frontend origin. OAuth redirect URIs pinned to that origin.

## 13. Deployment

- Cloud Run. `min-instances=0` for cost, or `1` to avoid Vertex-init cold starts (choose at deploy).
- Vertex region for Gemini set via env.
- Frontend stays Next.js (Vercel or Cloud Run), calling this API.
- Config via env: `GEMINI_MODEL`, Vertex region/project, provider client IDs; secrets from Secret Manager.

## 14. Testing (pytest)

- **Unit:** providers with mocked HTTP; the vision-response → `Album` mapper; confidence blending; `unrecognized` gating; Apple track chunking.
- **Accuracy regression:** a golden set of ~10 known CD photos → expected `{artist, title}`.
- **Integration:** Spotify redirect flow and Apple token handoff against provider sandboxes; playlist creation against test accounts.
- Note: the existing front end has no tests; this suite is backend-only.

## 15. Cost (recognition, per 1,000 photos)

Assumes ≈1,000 input tokens/image (tiled cover + short prompt) and ≈50 output tokens. Metadata/search and Cloud Run are free/negligible and excluded.

| Path | Vision via API? | GCP-native? | $ / 1,000 images |
|---|:---:|:---:|---:|
| **Gemini 3.1 Flash-Lite (chosen)** | yes | yes | ~$0.33 |
| Gemini 2.5 Flash-Lite (retires Oct 16 2026) | yes | yes | ~$0.12 |
| Qwen2.5-VL 7B (Fireworks) | yes | no | ~$0.21 |
| Qwen2.5-VL 32B (Fireworks) | yes | no | ~$0.95 |
| OCR (Cloud Vision) + DeepSeek V4 Flash | no (DeepSeek is text-only) | mixed | ~$1.54 |

At any realistic volume, model cost is a rounding error (10,000 photos/month ≈ $3.30 on 3.1 Flash-Lite). Downscaling to ≤768px client-side (single tile) cuts it further. DeepSeek cannot do the image step at all via its public API as of July 2026.

## 16. Future increments (out of scope for v1)

- Persistence: Firestore + real user accounts, scan history, saved playlists.
- Confidence-based fallback loop (reverse-image search, cross-checks) — the point at which an agent framework (ADK/LangGraph) would earn its place.
- Simultaneous multi-service support for one user.
- Batch recognition endpoint if per-image latency becomes a bottleneck.
