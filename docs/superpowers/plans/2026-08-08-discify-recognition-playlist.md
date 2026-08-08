# Discify Recognition + Playlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Discify's two mocked seams with a working end-to-end app: photograph CDs → Gemini recognizes each album → build a real playlist on the user's chosen streaming service.

**Architecture:** A Python FastAPI backend in `backend/` (deployed to Cloud Run) does the vision call (Gemini 3.1 Flash-Lite via `google-genai` on Vertex) and talks to the user's logged-in streaming service through a single `PlaylistProvider` abstraction. The existing Next.js frontend adds a login-first gate, swaps its mock calls for `fetch`, and adds confidence display + manual override. No database — the provider credential lives only in a signed session cookie.

**Tech Stack:** FastAPI · `google-genai` · Pydantic · `httpx` · `PyJWT[crypto]` · `itsdangerous` · pytest / `respx`; frontend: Next.js 16 / React 19 / TypeScript / Tailwind 4 / MusicKit JS.

**Design spec:** `docs/superpowers/specs/2026-07-21-discify-backend-design.md` — read it before starting.

## Global Constraints

- **Frontend is Next.js 16 / React 19 — not the version in your training data.** Before writing any frontend code, read the relevant guide under `node_modules/next/dist/docs/01-app/` and heed deprecation notices (per repo `AGENTS.md`).
- **No agent framework.** Backend is plain FastAPI + `google-genai`. Do not introduce ADK or LangChain.
- **Model name is env-configurable:** `GEMINI_MODEL`, default `gemini-3.1-flash-lite`. Confirm the exact model id in Vertex Model Garden at implementation time; never hardcode it in call sites.
- **No database in v1.** The provider credential lives only in a signed, `httpOnly`, short-TTL session cookie. Nothing is persisted server-side.
- **Secrets** (Spotify client secret, Apple `.p8` key + key/team IDs, session-signing secret) come from env, sourced from Secret Manager in production. Never commit them.
- **Login-first:** every data endpoint (`/api/recognize`, `/api/albums/*`, `/api/playlist`) requires a valid session; return `401` otherwise.
- **Images are downscaled to ≤768px client-side** before upload (single Gemini tile → cheapest + fastest).
- **Confidence threshold** default `0.6`, env-configurable as `CONFIDENCE_THRESHOLD`.
- **Apple Music playlists are append-only**, adds are chunked (≤300 tracks/request) with retries, and freshly created playlists read back empty for a few seconds — never immediately re-fetch to confirm.
- **CORS** is restricted to the frontend origin (`FRONTEND_ORIGIN` env); OAuth redirect URIs are pinned to that origin.
- Backend Python 3.12+. Run tests with `pytest` from `backend/`. Commit after every task.

---

## File Structure

**Backend (new, under `backend/`):**
- `pyproject.toml` — deps + pytest config
- `app/main.py` — FastAPI app, CORS, router registration, `/health`
- `app/config.py` — `Settings` (pydantic-settings) from env
- `app/models.py` — DTOs: `Track`, `Album`, `VisionResult`, `RecognitionResult`, `Unrecognized`, `PlaylistResult`, `Session`
- `app/confidence.py` — `blend_confidence()`
- `app/recognition/vision.py` — Gemini vision call
- `app/recognition/service.py` — orchestration (vision → provider → confidence → result)
- `app/providers/base.py` — `PlaylistProvider` Protocol + `TrackId`
- `app/providers/fake.py` — in-memory provider for tests
- `app/providers/spotify.py` — `SpotifyProvider`
- `app/providers/apple.py` — `AppleMusicProvider`
- `app/providers/registry.py` — `get_provider(service)`
- `app/auth/session.py` — cookie encode/decode + `require_session` dependency
- `app/auth/routes.py` — auth endpoints
- `app/routes/recognize.py`, `app/routes/albums.py`, `app/routes/playlist.py`
- `tests/…` mirrors `app/…`

**Frontend (modify existing at repo root):**
- `types/index.ts` — add `Album.confidence`, `ScannedCD.source`
- `lib/api.ts` (new) — backend client
- `lib/image.ts` (new) — client-side downscale
- `hooks/useCDScanner.ts`, `hooks/usePlaylist.ts` — mock → real
- `components/auth/LoginGate.tsx` (new), `components/album/AlbumCard.tsx`, `components/album/AlbumEditor.tsx` (new)
- `app/page.tsx` — gate on session
- `.env.local` — `NEXT_PUBLIC_API_BASE_URL`

---

## Phase 0 — Backend scaffold

### Task 1: Project scaffold, config, health check

**Files:**
- Create: `backend/pyproject.toml`, `backend/app/__init__.py`, `backend/app/main.py`, `backend/app/config.py`, `backend/tests/__init__.py`, `backend/tests/test_health.py`

**Interfaces:**
- Produces: `app.main:app` (FastAPI instance); `app.config.get_settings() -> Settings` with fields `gemini_model: str`, `vertex_project: str`, `vertex_location: str`, `frontend_origin: str`, `session_secret: str`, `confidence_threshold: float`.

- [ ] **Step 1: Write `backend/pyproject.toml`**

```toml
[project]
name = "discify-backend"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "google-genai>=1.33",
  "httpx>=0.27",
  "pydantic>=2.7",
  "pydantic-settings>=2.3",
  "python-multipart>=0.0.9",
  "pyjwt[crypto]>=2.8",
  "itsdangerous>=2.2",
]

[dependency-groups]
dev = ["pytest>=8", "respx>=0.21", "anyio>=4"]

[tool.pytest.ini_options]
addopts = "-q"
testpaths = ["tests"]
```

- [ ] **Step 2: Write the failing test** — `backend/tests/test_health.py`

```python
from fastapi.testclient import TestClient
from app.main import app

def test_health_ok():
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

- [ ] **Step 3: Run it, verify it fails**

Run: `cd backend && uv run pytest tests/test_health.py -v` (or `pip install -e '.[dev]'` then `pytest`)
Expected: FAIL — `ModuleNotFoundError: app.main`.

- [ ] **Step 4: Write `backend/app/config.py`**

```python
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    gemini_model: str = "gemini-3.1-flash-lite"
    vertex_project: str = ""
    vertex_location: str = "us-central1"
    frontend_origin: str = "http://localhost:3000"
    session_secret: str = "dev-only-change-me"
    confidence_threshold: float = 0.6

@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 5: Write `backend/app/main.py`**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings

def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Discify API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app

app = create_app()
```

- [ ] **Step 6: Run tests, verify pass**

Run: `cd backend && uv run pytest -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat(backend): scaffold FastAPI app with config and health check"
```

---

## Phase 1 — Recognition core

### Task 2: Domain models

**Files:**
- Create: `backend/app/models.py`, `backend/tests/test_models.py`

**Interfaces:**
- Produces:
  - `Track(id: str, number: int, title: str, durationSeconds: int)`
  - `Album(id: str, title: str, artist: str, year: int | None, genre: str | None, coverUrl: str | None, tracks: list[Track], totalDurationSeconds: int, confidence: float)`
  - `VisionResult(artist: str, title: str, modelConfidence: float, isAlbumCover: bool)`
  - `Unrecognized(reason: str)` and `RecognitionResult = Album | Unrecognized`
  - `TrackId = str`
  - `PlaylistResult(playlistUrl: str, addedCount: int, missed: list[str])`
  - Field names are camelCase to match the frontend `types/index.ts` exactly.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_models.py`

```python
from app.models import Album, Track, VisionResult, Unrecognized

def test_album_serializes_camelcase():
    album = Album(
        id="a1", title="OK Computer", artist="Radiohead", year=1997,
        genre="Alt Rock", coverUrl="http://x/y.jpg",
        tracks=[Track(id="t1", number=1, title="Airbag", durationSeconds=294)],
        totalDurationSeconds=294, confidence=0.9,
    )
    dumped = album.model_dump()
    assert dumped["totalDurationSeconds"] == 294
    assert dumped["tracks"][0]["durationSeconds"] == 294

def test_vision_and_unrecognized():
    v = VisionResult(artist="Radiohead", title="OK Computer", modelConfidence=0.8, isAlbumCover=True)
    assert v.isAlbumCover is True
    assert Unrecognized(reason="not_a_cd").reason == "not_a_cd"
```

- [ ] **Step 2: Run it, verify it fails** — `cd backend && uv run pytest tests/test_models.py -v` → FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Write `backend/app/models.py`**

```python
from pydantic import BaseModel

TrackId = str

class Track(BaseModel):
    id: str
    number: int
    title: str
    durationSeconds: int

class Album(BaseModel):
    id: str
    title: str
    artist: str
    year: int | None = None
    genre: str | None = None
    coverUrl: str | None = None
    tracks: list[Track]
    totalDurationSeconds: int
    confidence: float

class VisionResult(BaseModel):
    artist: str
    title: str
    modelConfidence: float
    isAlbumCover: bool

class Unrecognized(BaseModel):
    reason: str

RecognitionResult = Album | Unrecognized

class PlaylistResult(BaseModel):
    playlistUrl: str
    addedCount: int
    missed: list[str] = []

class Session(BaseModel):
    service: str          # "spotify" | "apple"
    market: str           # ISO country / storefront
    token: str            # provider access/user token
    extra: dict[str, str] = {}   # e.g. apple developer token
```

- [ ] **Step 4: Run tests, verify pass** — `uv run pytest tests/test_models.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/test_models.py
git commit -m "feat(backend): add domain models matching frontend types"
```

### Task 3: PlaylistProvider protocol + fake provider

**Files:**
- Create: `backend/app/providers/__init__.py`, `backend/app/providers/base.py`, `backend/app/providers/fake.py`, `backend/tests/test_fake_provider.py`

**Interfaces:**
- Produces `PlaylistProvider` Protocol:
  - `search_albums(self, query: str, market: str) -> list[Album]`
  - `resolve_album(self, artist: str, title: str, market: str) -> Album | None`
  - `resolve_tracks(self, album: Album, market: str) -> list[TrackId]`
  - `create_playlist(self, token: str, name: str, track_ids: list[TrackId]) -> PlaylistResult`
- `FakeProvider(albums: list[Album])` implements it for tests: `resolve_album` returns the album whose `artist`+`title` case-insensitively matches, else `None`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_fake_provider.py`

```python
from app.models import Album, Track
from app.providers.fake import FakeProvider

def _album(artist, title):
    return Album(id="x", title=title, artist=artist, year=1997, genre=None,
                 coverUrl=None, tracks=[Track(id="t", number=1, title="A", durationSeconds=100)],
                 totalDurationSeconds=100, confidence=0.0)

def test_resolve_album_matches_case_insensitive():
    p = FakeProvider([_album("Radiohead", "OK Computer")])
    assert p.resolve_album("radiohead", "ok computer", "US") is not None
    assert p.resolve_album("Nobody", "Nothing", "US") is None
```

- [ ] **Step 2: Run it, verify it fails** → FAIL.

- [ ] **Step 3: Write `backend/app/providers/base.py`**

```python
from typing import Protocol
from app.models import Album, PlaylistResult, TrackId

class PlaylistProvider(Protocol):
    def search_albums(self, query: str, market: str) -> list[Album]: ...
    def resolve_album(self, artist: str, title: str, market: str) -> Album | None: ...
    def resolve_tracks(self, album: Album, market: str) -> list[TrackId]: ...
    def create_playlist(self, token: str, name: str, track_ids: list[TrackId]) -> PlaylistResult: ...
```

- [ ] **Step 4: Write `backend/app/providers/fake.py`**

```python
from app.models import Album, PlaylistResult, TrackId

class FakeProvider:
    def __init__(self, albums: list[Album]):
        self._albums = albums

    def search_albums(self, query: str, market: str) -> list[Album]:
        q = query.lower()
        return [a for a in self._albums if q in f"{a.artist} {a.title}".lower()]

    def resolve_album(self, artist: str, title: str, market: str) -> Album | None:
        key = (artist.lower().strip(), title.lower().strip())
        for a in self._albums:
            if (a.artist.lower().strip(), a.title.lower().strip()) == key:
                return a
        return None

    def resolve_tracks(self, album: Album, market: str) -> list[TrackId]:
        return [t.id for t in album.tracks]

    def create_playlist(self, token: str, name: str, track_ids: list[TrackId]) -> PlaylistResult:
        return PlaylistResult(playlistUrl="http://fake/playlist", addedCount=len(track_ids), missed=[])
```

- [ ] **Step 5: Run tests, verify pass** → PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/providers backend/tests/test_fake_provider.py
git commit -m "feat(backend): add PlaylistProvider protocol and fake provider"
```

### Task 4: Confidence blending

**Files:**
- Create: `backend/app/confidence.py`, `backend/tests/test_confidence.py`

**Interfaces:**
- Produces `blend_confidence(model_confidence: float, match_found: bool) -> float`: returns `0.0` when no catalog match; otherwise the mean of `model_confidence` and `1.0`, clamped to `[0, 1]`. (Rationale: a strong unique catalog match is a hard positive signal; absence forces low confidence.)

- [ ] **Step 1: Write the failing test** — `backend/tests/test_confidence.py`

```python
from app.confidence import blend_confidence

def test_no_match_is_zero():
    assert blend_confidence(0.9, match_found=False) == 0.0

def test_match_blends_toward_one():
    assert blend_confidence(0.6, match_found=True) == 0.8

def test_clamps():
    assert blend_confidence(2.0, match_found=True) == 1.0
    assert blend_confidence(-1.0, match_found=True) == 0.5
```

- [ ] **Step 2: Run it, verify it fails** → FAIL.

- [ ] **Step 3: Write `backend/app/confidence.py`**

```python
def blend_confidence(model_confidence: float, match_found: bool) -> float:
    if not match_found:
        return 0.0
    m = max(0.0, min(1.0, model_confidence))
    return (m + 1.0) / 2.0
```

- [ ] **Step 4: Run tests, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/confidence.py backend/tests/test_confidence.py
git commit -m "feat(backend): add confidence blending"
```

### Task 5: Vision call (Gemini via Vertex)

**Files:**
- Create: `backend/app/recognition/__init__.py`, `backend/app/recognition/vision.py`, `backend/tests/test_vision.py`

**Interfaces:**
- Consumes: `app.config.get_settings`, `app.models.VisionResult`.
- Produces: `recognize_image(image_bytes: bytes, mime_type: str, *, client=None) -> VisionResult`. The `client` param is injectable so tests pass a fake; production builds a real `genai.Client`.

**Reference:** verified `google-genai` pattern — `genai.Client(vertexai=True, project=..., location=...)`, `client.models.generate_content(model=..., contents=[prompt, types.Part.from_bytes(...)], config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=VisionResult))`, read `response.parsed`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_vision.py`

```python
from app.models import VisionResult
from app.recognition.vision import recognize_image

class _FakeModels:
    def generate_content(self, **kwargs):
        class R: parsed = VisionResult(artist="Radiohead", title="OK Computer",
                                       modelConfidence=0.82, isAlbumCover=True)
        return R()

class _FakeClient:
    models = _FakeModels()

def test_recognize_image_parses_vision_result():
    out = recognize_image(b"\x89PNG...", "image/png", client=_FakeClient())
    assert out.artist == "Radiohead"
    assert out.isAlbumCover is True
    assert 0.0 <= out.modelConfidence <= 1.0
```

- [ ] **Step 2: Run it, verify it fails** → FAIL.

- [ ] **Step 3: Write `backend/app/recognition/vision.py`**

```python
from google import genai
from google.genai import types
from app.config import get_settings
from app.models import VisionResult

_PROMPT = (
    "You are identifying a music album from a photo of its CD cover. "
    "Return the album's primary artist and exact album title. "
    "Set isAlbumCover=false if the image is not a music album cover. "
    "modelConfidence is your 0-1 confidence in the identification."
)

def _build_client() -> genai.Client:
    s = get_settings()
    return genai.Client(vertexai=True, project=s.vertex_project, location=s.vertex_location)

def recognize_image(image_bytes: bytes, mime_type: str, *, client: genai.Client | None = None) -> VisionResult:
    client = client or _build_client()
    settings = get_settings()
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=[_PROMPT, types.Part.from_bytes(data=image_bytes, mime_type=mime_type)],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=VisionResult,
        ),
    )
    result = response.parsed
    if isinstance(result, VisionResult):
        return result
    # Fallback if the SDK returns raw text
    return VisionResult.model_validate_json(response.text)
```

- [ ] **Step 4: Run tests, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/recognition backend/tests/test_vision.py
git commit -m "feat(backend): add Gemini vision recognition call"
```

### Task 6: Recognition service (orchestration)

**Files:**
- Create: `backend/app/recognition/service.py`, `backend/tests/test_recognition_service.py`

**Interfaces:**
- Consumes: `recognize_image`, `PlaylistProvider`, `blend_confidence`, settings.
- Produces: `recognize_cd(image_bytes, mime_type, provider, market, *, vision=recognize_image) -> RecognitionResult`. Returns `Unrecognized` when `isAlbumCover` is false, when `modelConfidence < CONFIDENCE_THRESHOLD` *and* no catalog match, or when `resolve_album` returns `None`. Otherwise returns the resolved `Album` with `confidence` set by `blend_confidence`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_recognition_service.py`

```python
from app.models import Album, Track, VisionResult, Unrecognized
from app.providers.fake import FakeProvider
from app.recognition.service import recognize_cd

def _album(artist, title):
    return Album(id="x", title=title, artist=artist, year=1997, genre=None, coverUrl=None,
                 tracks=[Track(id="t", number=1, title="A", durationSeconds=100)],
                 totalDurationSeconds=100, confidence=0.0)

def _vision(**kw):
    def fn(image_bytes, mime_type, client=None):
        return VisionResult(**kw)
    return fn

def test_returns_album_with_blended_confidence():
    provider = FakeProvider([_album("Radiohead", "OK Computer")])
    out = recognize_cd(b"x", "image/png", provider, "US",
                       vision=_vision(artist="Radiohead", title="OK Computer",
                                      modelConfidence=0.8, isAlbumCover=True))
    assert isinstance(out, Album)
    assert out.confidence == 0.9

def test_not_a_cover_is_unrecognized():
    provider = FakeProvider([])
    out = recognize_cd(b"x", "image/png", provider, "US",
                       vision=_vision(artist="", title="", modelConfidence=0.1, isAlbumCover=False))
    assert isinstance(out, Unrecognized)

def test_no_catalog_match_is_unrecognized():
    provider = FakeProvider([])
    out = recognize_cd(b"x", "image/png", provider, "US",
                       vision=_vision(artist="Ghost", title="Nowhere",
                                      modelConfidence=0.9, isAlbumCover=True))
    assert isinstance(out, Unrecognized)
```

- [ ] **Step 2: Run it, verify it fails** → FAIL.

- [ ] **Step 3: Write `backend/app/recognition/service.py`**

```python
from app.confidence import blend_confidence
from app.models import Album, RecognitionResult, Unrecognized
from app.providers.base import PlaylistProvider
from app.recognition.vision import recognize_image

def recognize_cd(image_bytes: bytes, mime_type: str, provider: PlaylistProvider,
                 market: str, *, vision=recognize_image) -> RecognitionResult:
    v = vision(image_bytes, mime_type)
    if not v.isAlbumCover:
        return Unrecognized(reason="not_an_album_cover")

    album = provider.resolve_album(v.artist, v.title, market)
    if album is None:
        return Unrecognized(reason="not_found_in_catalog")

    # A real catalog match is never dropped; low scores are flagged in the UI, not here.
    confidence = blend_confidence(v.modelConfidence, match_found=True)
    return album.model_copy(update={"confidence": confidence})
```

- [ ] **Step 4: Run tests, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/recognition/service.py backend/tests/test_recognition_service.py
git commit -m "feat(backend): add recognition orchestration service"
```

---

## Phase 2 — Auth + Spotify provider

### Task 7: Session cookie + require_session dependency

**Files:**
- Create: `backend/app/auth/__init__.py`, `backend/app/auth/session.py`, `backend/tests/test_session.py`

**Interfaces:**
- Consumes: `app.models.Session`, settings.
- Produces:
  - `encode_session(session: Session) -> str` and `decode_session(raw: str) -> Session | None` (signed with `itsdangerous.URLSafeTimedSerializer`, `session_secret`, max age 3600s).
  - `require_session(request: Request) -> Session` FastAPI dependency — reads the `discify_session` cookie, raises `HTTPException(401)` if missing/invalid.
  - `SESSION_COOKIE = "discify_session"`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_session.py`

```python
from app.models import Session
from app.auth.session import encode_session, decode_session

def test_roundtrip():
    s = Session(service="spotify", market="US", token="abc", extra={})
    raw = encode_session(s)
    back = decode_session(raw)
    assert back is not None and back.service == "spotify" and back.token == "abc"

def test_tampered_is_none():
    assert decode_session("not-a-valid-cookie") is None
```

- [ ] **Step 2: Run it, verify it fails** → FAIL.

- [ ] **Step 3: Write `backend/app/auth/session.py`**

```python
from fastapi import HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from app.config import get_settings
from app.models import Session

SESSION_COOKIE = "discify_session"
_MAX_AGE = 3600

def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().session_secret, salt="discify-session")

def encode_session(session: Session) -> str:
    return _serializer().dumps(session.model_dump())

def decode_session(raw: str) -> Session | None:
    try:
        data = _serializer().loads(raw, max_age=_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    return Session.model_validate(data)

def require_session(request: Request) -> Session:
    raw = request.cookies.get(SESSION_COOKIE)
    session = decode_session(raw) if raw else None
    if session is None:
        raise HTTPException(status_code=401, detail="not_authenticated")
    return session
```

- [ ] **Step 4: Run tests, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth backend/tests/test_session.py
git commit -m "feat(backend): add signed session cookie and auth dependency"
```

### Task 8: Spotify provider — search & resolve

**Files:**
- Create: `backend/app/providers/spotify.py`, `backend/tests/test_spotify_provider.py`

**Interfaces:**
- Consumes: `httpx`, `Album`, `Track`, settings.
- Produces: `SpotifyProvider(token: str)` implementing `search_albums`, `resolve_album` (via `GET /v1/search?type=album` then `GET /v1/albums/{id}` for the full tracklist). Map Spotify's `duration_ms` → `durationSeconds` (integer division by 1000). `resolve_album` returns the top album match, or `None` if the search is empty.

**Reference:** Spotify Web API — confirm exact request/response shapes at https://developer.spotify.com/documentation/web-api. Search: `GET https://api.spotify.com/v1/search?q={q}&type=album&market={market}&limit=5`. Album tracks: `GET /v1/albums/{id}` returns `tracks.items[]` with `duration_ms`, `track_number`, `name`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_spotify_provider.py`

```python
import httpx, respx
from app.providers.spotify import SpotifyProvider

@respx.mock
def test_resolve_album_maps_tracks():
    respx.get("https://api.spotify.com/v1/search").mock(return_value=httpx.Response(200, json={
        "albums": {"items": [{"id": "alb1", "name": "OK Computer",
                              "artists": [{"name": "Radiohead"}],
                              "release_date": "1997-05-21",
                              "images": [{"url": "http://cover"}]}]}
    }))
    respx.get("https://api.spotify.com/v1/albums/alb1").mock(return_value=httpx.Response(200, json={
        "id": "alb1", "name": "OK Computer", "artists": [{"name": "Radiohead"}],
        "release_date": "1997-05-21", "images": [{"url": "http://cover"}],
        "tracks": {"items": [{"id": "trk1", "name": "Airbag", "track_number": 1, "duration_ms": 294000}]}
    }))
    album = SpotifyProvider(token="t").resolve_album("Radiohead", "OK Computer", "US")
    assert album is not None
    assert album.tracks[0].durationSeconds == 294
    assert album.totalDurationSeconds == 294

@respx.mock
def test_resolve_album_none_when_empty():
    respx.get("https://api.spotify.com/v1/search").mock(return_value=httpx.Response(200, json={"albums": {"items": []}}))
    assert SpotifyProvider(token="t").resolve_album("x", "y", "US") is None
```

- [ ] **Step 2: Run it, verify it fails** → FAIL.

- [ ] **Step 3: Write `backend/app/providers/spotify.py`** (search + resolve; publish methods added in Task 9)

```python
import httpx
from app.models import Album, Track, PlaylistResult, TrackId

_BASE = "https://api.spotify.com/v1"

class SpotifyProvider:
    def __init__(self, token: str):
        self._headers = {"Authorization": f"Bearer {token}"}

    def _album_from_payload(self, payload: dict) -> Album:
        items = payload.get("tracks", {}).get("items", [])
        tracks = [
            Track(id=t["id"], number=t["track_number"], title=t["name"],
                  durationSeconds=t["duration_ms"] // 1000)
            for t in items
        ]
        year = int(payload["release_date"][:4]) if payload.get("release_date") else None
        images = payload.get("images") or []
        return Album(
            id=payload["id"], title=payload["name"],
            artist=", ".join(a["name"] for a in payload.get("artists", [])),
            year=year, genre=None, coverUrl=images[0]["url"] if images else None,
            tracks=tracks, totalDurationSeconds=sum(t.durationSeconds for t in tracks),
            confidence=0.0,
        )

    def search_albums(self, query: str, market: str) -> list[Album]:
        with httpx.Client(timeout=10) as c:
            r = c.get(f"{_BASE}/search", headers=self._headers,
                      params={"q": query, "type": "album", "market": market, "limit": 5})
            r.raise_for_status()
            items = r.json().get("albums", {}).get("items", [])
            return [self._album_from_payload(self._fetch_album(c, a["id"])) for a in items]

    def _fetch_album(self, client: httpx.Client, album_id: str) -> dict:
        r = client.get(f"{_BASE}/albums/{album_id}", headers=self._headers, params={"market": ""})
        r.raise_for_status()
        return r.json()

    def resolve_album(self, artist: str, title: str, market: str) -> Album | None:
        with httpx.Client(timeout=10) as c:
            r = c.get(f"{_BASE}/search", headers=self._headers,
                      params={"q": f"artist:{artist} album:{title}", "type": "album",
                              "market": market, "limit": 1})
            r.raise_for_status()
            items = r.json().get("albums", {}).get("items", [])
            if not items:
                return None
            return self._album_from_payload(self._fetch_album(c, items[0]["id"]))

    def resolve_tracks(self, album: Album, market: str) -> list[TrackId]:
        return [f"spotify:track:{t.id}" for t in album.tracks]

    def create_playlist(self, token: str, name: str, track_ids: list[TrackId]) -> PlaylistResult:
        raise NotImplementedError  # Task 9
```

- [ ] **Step 4: Run tests, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/providers/spotify.py backend/tests/test_spotify_provider.py
git commit -m "feat(backend): add Spotify search and album resolution"
```

### Task 9: Spotify provider — create playlist + auth routes

**Files:**
- Modify: `backend/app/providers/spotify.py` (implement `create_playlist`)
- Create: `backend/app/auth/routes.py`, `backend/tests/test_spotify_create.py`, `backend/tests/test_auth_routes.py`

**Interfaces:**
- `SpotifyProvider.create_playlist(token, name, track_ids)` — `GET /v1/me` for user id, `POST /v1/users/{uid}/playlists`, then `POST /v1/playlists/{pid}/tracks` with `uris`. Returns `PlaylistResult(playlistUrl=<external_urls.spotify>, addedCount=len(track_ids), missed=[])`.
- Auth routes: `GET /api/auth/spotify/login` (redirect to Spotify consent, Auth Code + PKCE, `state`), `GET /api/auth/spotify/callback` (exchange code, fetch market from `GET /v1/me` `country`, set signed session cookie, redirect to `FRONTEND_ORIGIN`).

**Reference:** Spotify auth — https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow. Scopes needed: `playlist-modify-private playlist-modify-public`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_spotify_create.py`

```python
import httpx, respx
from app.providers.spotify import SpotifyProvider

@respx.mock
def test_create_playlist_returns_url_and_count():
    respx.get("https://api.spotify.com/v1/me").mock(return_value=httpx.Response(200, json={"id": "user1", "country": "US"}))
    respx.post("https://api.spotify.com/v1/users/user1/playlists").mock(return_value=httpx.Response(201, json={
        "id": "pl1", "external_urls": {"spotify": "http://open/pl1"}}))
    respx.post("https://api.spotify.com/v1/playlists/pl1/tracks").mock(return_value=httpx.Response(201, json={"snapshot_id": "s"}))
    res = SpotifyProvider(token="t").create_playlist("t", "My CDs", ["spotify:track:a", "spotify:track:b"])
    assert res.playlistUrl == "http://open/pl1"
    assert res.addedCount == 2
```

- [ ] **Step 2: Run it, verify it fails** → FAIL.

- [ ] **Step 3: Implement `create_playlist` in `spotify.py`**

```python
    def create_playlist(self, token: str, name: str, track_ids: list[TrackId]) -> PlaylistResult:
        with httpx.Client(timeout=15) as c:
            me = c.get(f"{_BASE}/me", headers=self._headers); me.raise_for_status()
            uid = me.json()["id"]
            created = c.post(f"{_BASE}/users/{uid}/playlists", headers=self._headers,
                             json={"name": name, "public": False})
            created.raise_for_status()
            pl = created.json()
            for i in range(0, len(track_ids), 100):  # Spotify caps 100 uris/request
                add = c.post(f"{_BASE}/playlists/{pl['id']}/tracks", headers=self._headers,
                             json={"uris": track_ids[i:i + 100]})
                add.raise_for_status()
            return PlaylistResult(playlistUrl=pl["external_urls"]["spotify"],
                                  addedCount=len(track_ids), missed=[])
```

- [ ] **Step 4: Run test, verify pass** → PASS.

- [ ] **Step 5: Write `backend/app/auth/routes.py`** (Spotify login + callback; Apple added in Task 12)

```python
import base64, hashlib, os, secrets, httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from app.config import get_settings
from app.models import Session
from app.auth.session import SESSION_COOKIE, encode_session

router = APIRouter(prefix="/api/auth")
_VERIFIERS: dict[str, str] = {}  # state -> code_verifier (single-instance dev store)

@router.get("/spotify/login")
def spotify_login():
    s = get_settings()
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    _VERIFIERS[state] = verifier
    params = {
        "client_id": os.environ["SPOTIFY_CLIENT_ID"],
        "response_type": "code",
        "redirect_uri": f"{os.environ['BACKEND_ORIGIN']}/api/auth/spotify/callback",
        "scope": "playlist-modify-private playlist-modify-public",
        "code_challenge_method": "S256", "code_challenge": challenge, "state": state,
    }
    url = "https://accounts.spotify.com/authorize?" + httpx.QueryParams(params).__str__()
    return RedirectResponse(url)

@router.get("/spotify/callback")
def spotify_callback(request: Request, code: str, state: str):
    s = get_settings()
    verifier = _VERIFIERS.pop(state, None)
    if verifier is None:
        raise HTTPException(400, "bad_state")
    with httpx.Client(timeout=10) as c:
        tok = c.post("https://accounts.spotify.com/api/token", data={
            "grant_type": "authorization_code", "code": code,
            "redirect_uri": f"{os.environ['BACKEND_ORIGIN']}/api/auth/spotify/callback",
            "client_id": os.environ["SPOTIFY_CLIENT_ID"], "code_verifier": verifier,
        })
        tok.raise_for_status()
        access = tok.json()["access_token"]
        me = c.get("https://api.spotify.com/v1/me", headers={"Authorization": f"Bearer {access}"})
        me.raise_for_status()
        market = me.json().get("country", "US")
    session = Session(service="spotify", market=market, token=access, extra={})
    resp = RedirectResponse(s.frontend_origin)
    resp.set_cookie(SESSION_COOKIE, encode_session(session), httponly=True,
                    secure=True, samesite="lax", max_age=3600)
    return resp
```

- [ ] **Step 6: Write `backend/tests/test_auth_routes.py`** — assert `/api/auth/spotify/login` returns a redirect (302) to `accounts.spotify.com` (set required env vars via `monkeypatch`).

```python
import os
from fastapi.testclient import TestClient
from app.main import app

def test_spotify_login_redirects(monkeypatch):
    monkeypatch.setenv("SPOTIFY_CLIENT_ID", "cid")
    monkeypatch.setenv("BACKEND_ORIGIN", "http://localhost:8080")
    client = TestClient(app, follow_redirects=False)
    r = client.get("/api/auth/spotify/login")
    assert r.status_code in (302, 307)
    assert "accounts.spotify.com" in r.headers["location"]
```

- [ ] **Step 7: Register the router** in `app/main.py` — add `from app.auth.routes import router as auth_router` and `app.include_router(auth_router)` inside `create_app()`.

- [ ] **Step 8: Run tests, verify pass** → PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/app/providers/spotify.py backend/app/auth/routes.py backend/app/main.py backend/tests/
git commit -m "feat(backend): Spotify playlist creation and OAuth routes"
```

### Task 10: Provider registry + data routes wired to session

**Files:**
- Create: `backend/app/providers/registry.py`, `backend/app/routes/__init__.py`, `backend/app/routes/recognize.py`, `backend/app/routes/albums.py`, `backend/app/routes/playlist.py`, `backend/tests/test_data_routes.py`
- Modify: `backend/app/main.py` (register routers)

**Interfaces:**
- `get_provider(session: Session) -> PlaylistProvider` — returns `SpotifyProvider(session.token)` for `service == "spotify"` (Apple added Task 13). Raise `HTTPException(400)` for unknown service.
- `POST /api/recognize` (multipart `file`) → `RecognitionResult`; `require_session`.
- `GET /api/albums/search?q=` → `list[Album]`; `POST /api/albums/resolve` (`{artist, title}` or `{albumId}`) → `Album | Unrecognized`; both `require_session`.
- `POST /api/playlist` (`{name, albums: list[Album]}`) → `PlaylistResult`; resolves each album's tracks via the provider, concatenates, calls `create_playlist`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_data_routes.py`

```python
from fastapi.testclient import TestClient
from app.main import app
from app.models import Album, Track, Session
from app.auth.session import require_session
import app.routes.recognize as recognize_module

def _session():
    return Session(service="spotify", market="US", token="t", extra={})

def _album():
    return Album(id="a", title="OK Computer", artist="Radiohead", year=1997, genre=None,
                 coverUrl=None, tracks=[Track(id="t", number=1, title="Airbag", durationSeconds=294)],
                 totalDurationSeconds=294, confidence=0.9)

def test_recognize_requires_session():
    client = TestClient(app)
    r = client.post("/api/recognize", files={"file": ("x.jpg", b"data", "image/jpeg")})
    assert r.status_code == 401

def test_recognize_returns_album(monkeypatch):
    app.dependency_overrides[require_session] = _session
    monkeypatch.setattr(recognize_module, "recognize_cd", lambda *a, **k: _album())
    monkeypatch.setattr(recognize_module, "get_provider", lambda s: object())
    client = TestClient(app)
    r = client.post("/api/recognize", files={"file": ("x.jpg", b"data", "image/jpeg")})
    assert r.status_code == 200 and r.json()["title"] == "OK Computer"
    app.dependency_overrides.clear()

def test_recognize_rejects_non_image():
    app.dependency_overrides[require_session] = _session
    client = TestClient(app)
    r = client.post("/api/recognize", files={"file": ("x.txt", b"data", "text/plain")})
    assert r.status_code == 415
    app.dependency_overrides.clear()
```

- [ ] **Step 2: Run it, verify it fails** → FAIL.

- [ ] **Step 3: Write `registry.py`**

```python
from fastapi import HTTPException
from app.models import Session
from app.providers.base import PlaylistProvider
from app.providers.spotify import SpotifyProvider

def get_provider(session: Session) -> PlaylistProvider:
    if session.service == "spotify":
        return SpotifyProvider(session.token)
    raise HTTPException(400, "unsupported_service")
```

- [ ] **Step 4: Write `routes/recognize.py`**

```python
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from app.auth.session import require_session
from app.models import Session
from app.providers.registry import get_provider
from app.recognition.service import recognize_cd

router = APIRouter(prefix="/api")
_MAX_BYTES = 10 * 1024 * 1024  # 10 MB

@router.post("/recognize")
async def recognize(file: UploadFile = File(...), session: Session = Depends(require_session)):
    content_type = file.content_type or ""
    if not content_type.startswith("image/"):
        raise HTTPException(415, "unsupported_media_type")
    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(413, "file_too_large")
    provider = get_provider(session)
    return recognize_cd(data, content_type, provider, session.market)
```

- [ ] **Step 5: Write `routes/albums.py`**

```python
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.auth.session import require_session
from app.models import Session, Unrecognized
from app.providers.registry import get_provider

router = APIRouter(prefix="/api/albums")

class ResolveBody(BaseModel):
    artist: str | None = None
    title: str | None = None

@router.get("/search")
def search(q: str, session: Session = Depends(require_session)):
    return get_provider(session).search_albums(q, session.market)

@router.post("/resolve")
def resolve(body: ResolveBody, session: Session = Depends(require_session)):
    provider = get_provider(session)
    album = provider.resolve_album(body.artist or "", body.title or "", session.market)
    if album is None:
        return Unrecognized(reason="not_found_in_catalog")
    return album.model_copy(update={"confidence": 1.0})  # manual override is trusted
```

- [ ] **Step 6: Write `routes/playlist.py`**

```python
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.auth.session import require_session
from app.models import Album, Session, PlaylistResult
from app.providers.registry import get_provider

router = APIRouter(prefix="/api")

class PlaylistBody(BaseModel):
    name: str
    albums: list[Album]

@router.post("/playlist")
def create(body: PlaylistBody, session: Session = Depends(require_session)) -> PlaylistResult:
    provider = get_provider(session)
    track_ids: list[str] = []
    for album in body.albums:
        track_ids.extend(provider.resolve_tracks(album, session.market))
    return provider.create_playlist(session.token, body.name, track_ids)
```

- [ ] **Step 7: Register routers** in `main.py` (`recognize`, `albums`, `playlist`).

- [ ] **Step 8: Run tests, verify pass** → PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/app/routes backend/app/providers/registry.py backend/app/main.py backend/tests/test_data_routes.py
git commit -m "feat(backend): wire recognize/albums/playlist routes to session + provider"
```

---

## Phase 3 — Apple Music provider

### Task 11: Apple developer token + auth routes

**Files:**
- Create: `backend/app/providers/apple_auth.py`, `backend/tests/test_apple_auth.py`
- Modify: `backend/app/auth/routes.py` (add `GET /api/auth/apple/developer-token`, `POST /api/auth/apple/session`)

**Interfaces:**
- `make_developer_token(team_id, key_id, private_key_pem, *, ttl=3600) -> str` — ES256 JWT, `iss=team_id`, `iat`/`exp`, header `kid=key_id`.
- `GET /api/auth/apple/developer-token` → `{token}` for MusicKit JS.
- `POST /api/auth/apple/session` (`{userToken, storefront}`) → sets a session cookie with `service="apple"`, `market=storefront`, `token=userToken`, `extra={"developerToken": <fresh dev token>}`.

**Reference:** Apple developer token — https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens. Storefront from MusicKit JS `music.storefrontId`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_apple_auth.py`

```python
import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from app.providers.apple_auth import make_developer_token

def test_developer_token_is_es256_and_decodable():
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(serialization.Encoding.PEM,
                            serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption()).decode()
    token = make_developer_token("TEAMID", "KEYID", pem)
    header = jwt.get_unverified_header(token)
    assert header["alg"] == "ES256" and header["kid"] == "KEYID"
    decoded = jwt.decode(token, key.public_key(), algorithms=["ES256"])
    assert decoded["iss"] == "TEAMID"
```

- [ ] **Step 2: Run it, verify it fails** → FAIL.

- [ ] **Step 3: Write `backend/app/providers/apple_auth.py`**

```python
import time, jwt

def make_developer_token(team_id: str, key_id: str, private_key_pem: str, *, ttl: int = 3600) -> str:
    now = int(time.time())
    return jwt.encode(
        {"iss": team_id, "iat": now, "exp": now + ttl},
        private_key_pem, algorithm="ES256", headers={"kid": key_id},
    )
```

- [ ] **Step 4: Add Apple routes to `auth/routes.py`**

```python
import os
from pydantic import BaseModel
from app.providers.apple_auth import make_developer_token

def _apple_dev_token() -> str:
    return make_developer_token(os.environ["APPLE_TEAM_ID"], os.environ["APPLE_KEY_ID"],
                                os.environ["APPLE_PRIVATE_KEY"])

@router.get("/apple/developer-token")
def apple_developer_token():
    return {"token": _apple_dev_token()}

class AppleSessionBody(BaseModel):
    userToken: str
    storefront: str

@router.post("/apple/session")
def apple_session(body: AppleSessionBody):
    session = Session(service="apple", market=body.storefront, token=body.userToken,
                      extra={"developerToken": _apple_dev_token()})
    resp = JSONResponse({"ok": True})
    resp.set_cookie(SESSION_COOKIE, encode_session(session), httponly=True,
                    secure=True, samesite="lax", max_age=3600)
    return resp
```
(Add `from fastapi.responses import JSONResponse` import.)

- [ ] **Step 5: Run tests, verify pass** → PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/providers/apple_auth.py backend/app/auth/routes.py backend/tests/test_apple_auth.py
git commit -m "feat(backend): Apple developer token and auth routes"
```

### Task 12: AppleMusicProvider — search, resolve, create (chunked)

**Files:**
- Create: `backend/app/providers/apple.py`, `backend/tests/test_apple_provider.py`
- Modify: `backend/app/providers/registry.py` (add `apple` branch)

**Interfaces:**
- `AppleMusicProvider(user_token: str, developer_token: str, storefront: str)` implementing the protocol.
  - `resolve_album` → `GET /v1/catalog/{storefront}/search?types=albums&term=` then `GET /v1/catalog/{storefront}/albums/{id}?include=tracks`; map `attributes.durationInMillis` → `durationSeconds`.
  - `resolve_tracks` → catalog song ids.
  - `create_playlist` → `POST /v1/me/library/playlists` with initial tracks; append remaining in chunks of ≤300 via `POST /v1/me/library/playlists/{id}/tracks`; **never re-fetch to confirm** (async materialization). `missed` = tracks with no catalog id.

**Reference:** confirm shapes at https://developer.apple.com/documentation/applemusicapi. Headers: `Authorization: Bearer {developerToken}`, `Music-User-Token: {userToken}`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_apple_provider.py`

```python
import httpx, respx
from app.providers.apple import AppleMusicProvider

@respx.mock
def test_resolve_album_maps_tracks_and_artwork():
    respx.get("https://api.music.apple.com/v1/catalog/us/search").mock(return_value=httpx.Response(200, json={
        "results": {"albums": {"data": [{"id": "alb1"}]}}}))
    respx.get("https://api.music.apple.com/v1/catalog/us/albums/alb1").mock(return_value=httpx.Response(200, json={
        "data": [{"id": "alb1", "attributes": {"name": "OK Computer", "artistName": "Radiohead",
                   "releaseDate": "1997-05-21", "artwork": {"url": "http://a/{w}x{h}.jpg"}},
                  "relationships": {"tracks": {"data": [
                      {"id": "s1", "attributes": {"name": "Airbag", "trackNumber": 1,
                                                  "durationInMillis": 294000}}]}}}]}))
    album = AppleMusicProvider("user", "dev", "us").resolve_album("Radiohead", "OK Computer", "US")
    assert album is not None
    assert album.tracks[0].durationSeconds == 294
    assert album.coverUrl == "http://a/600x600.jpg"

@respx.mock
def test_create_playlist_chunks_appends():
    respx.post("https://api.music.apple.com/v1/me/library/playlists").mock(
        return_value=httpx.Response(201, json={"data": [{"id": "p1"}]}))
    append = respx.post("https://api.music.apple.com/v1/me/library/playlists/p1/tracks").mock(
        return_value=httpx.Response(201, json={"data": []}))
    ids = [f"s{i}" for i in range(350)]  # 300 in initial create, 50 appended
    res = AppleMusicProvider("user", "dev", "us").create_playlist("user", "My CDs", ids)
    assert res.addedCount == 350
    assert append.call_count == 1
```

- [ ] **Step 2: Run it, verify it fails** → FAIL.

- [ ] **Step 3: Write `backend/app/providers/apple.py`**

```python
import httpx
from app.models import Album, Track, PlaylistResult, TrackId

_BASE = "https://api.music.apple.com/v1"
_CHUNK = 300  # append-only, chunked (Global Constraints)

class AppleMusicProvider:
    def __init__(self, user_token: str, developer_token: str, storefront: str):
        self._sf = storefront
        self._headers = {"Authorization": f"Bearer {developer_token}",
                         "Music-User-Token": user_token}

    def _artwork(self, attrs: dict) -> str | None:
        art = attrs.get("artwork")
        if not art or "url" not in art:
            return None
        return art["url"].replace("{w}", "600").replace("{h}", "600")

    def _album_from_data(self, data: dict) -> Album:
        attrs = data["attributes"]
        tdata = data.get("relationships", {}).get("tracks", {}).get("data", [])
        tracks = [
            Track(id=t["id"], number=t["attributes"].get("trackNumber", i + 1),
                  title=t["attributes"]["name"],
                  durationSeconds=t["attributes"].get("durationInMillis", 0) // 1000)
            for i, t in enumerate(tdata)
        ]
        rel = attrs.get("releaseDate", "")
        return Album(
            id=data["id"], title=attrs["name"], artist=attrs.get("artistName", ""),
            year=int(rel[:4]) if rel[:4].isdigit() else None, genre=None,
            coverUrl=self._artwork(attrs), tracks=tracks,
            totalDurationSeconds=sum(t.durationSeconds for t in tracks), confidence=0.0,
        )

    def _fetch_album(self, client: httpx.Client, album_id: str) -> Album:
        r = client.get(f"{_BASE}/catalog/{self._sf}/albums/{album_id}", headers=self._headers)
        r.raise_for_status()
        return self._album_from_data(r.json()["data"][0])

    def search_albums(self, query: str, market: str) -> list[Album]:
        with httpx.Client(timeout=10) as c:
            r = c.get(f"{_BASE}/catalog/{self._sf}/search", headers=self._headers,
                      params={"term": query, "types": "albums", "limit": 5})
            r.raise_for_status()
            data = r.json().get("results", {}).get("albums", {}).get("data", [])
            return [self._fetch_album(c, a["id"]) for a in data]

    def resolve_album(self, artist: str, title: str, market: str) -> Album | None:
        with httpx.Client(timeout=10) as c:
            r = c.get(f"{_BASE}/catalog/{self._sf}/search", headers=self._headers,
                      params={"term": f"{artist} {title}", "types": "albums", "limit": 1})
            r.raise_for_status()
            data = r.json().get("results", {}).get("albums", {}).get("data", [])
            if not data:
                return None
            return self._fetch_album(c, data[0]["id"])

    def resolve_tracks(self, album: Album, market: str) -> list[TrackId]:
        return [t.id for t in album.tracks]

    def create_playlist(self, token: str, name: str, track_ids: list[TrackId]) -> PlaylistResult:
        first, rest = track_ids[:_CHUNK], track_ids[_CHUNK:]
        with httpx.Client(timeout=15) as c:
            created = c.post(f"{_BASE}/me/library/playlists", headers=self._headers, json={
                "attributes": {"name": name},
                "relationships": {"tracks": {"data": [{"id": t, "type": "songs"} for t in first]}}})
            created.raise_for_status()
            pid = created.json()["data"][0]["id"]
            for i in range(0, len(rest), _CHUNK):
                add = c.post(f"{_BASE}/me/library/playlists/{pid}/tracks", headers=self._headers,
                             json={"data": [{"id": t, "type": "songs"} for t in rest[i:i + _CHUNK]]})
                add.raise_for_status()
        # Library playlists have no public catalog URL; link into the user's library.
        return PlaylistResult(playlistUrl=f"https://music.apple.com/library/playlist/{pid}",
                              addedCount=len(track_ids), missed=[])
```

- [ ] **Step 4: Add `apple` branch to `registry.py`** (also `from app.providers.apple import AppleMusicProvider`)

```python
    if session.service == "apple":
        return AppleMusicProvider(session.token, session.extra["developerToken"], session.market)
```

- [ ] **Step 5: Run tests, verify pass** → PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/providers/apple.py backend/app/providers/registry.py backend/tests/test_apple_provider.py
git commit -m "feat(backend): Apple Music search, resolve, and chunked playlist creation"
```

---

## Phase 4 — Frontend integration

> Read `node_modules/next/dist/docs/01-app/` before editing frontend code (Global Constraints).

### Task 13: Types, env, and API client

**Files:**
- Modify: `types/index.ts`
- Create: `lib/api.ts`, `.env.local` (git-ignored; document in `.env.example`)

**Interfaces:**
- `types/index.ts`: add `confidence: number` to `Album`; add `source: 'auto' | 'manual'` to `ScannedCD`.
- `lib/api.ts` exports (all send `credentials: 'include'`, base `NEXT_PUBLIC_API_BASE_URL`):
  - `recognize(file: File): Promise<Album | { reason: string }>`
  - `searchAlbums(q: string): Promise<Album[]>`
  - `resolveAlbum(input: {artist?: string; title?: string; albumId?: string}): Promise<Album | { reason: string }>`
  - `createPlaylist(name: string, albums: Album[]): Promise<{playlistUrl: string; addedCount: number; missed: string[]}>`
  - `appleDeveloperToken(): Promise<{token: string}>`, `appleSession(userToken: string, storefront: string): Promise<void>`

- [ ] **Step 1** Add the two type fields to `types/index.ts` (`Album.confidence: number`, `ScannedCD.source: 'auto' | 'manual'`).
- [ ] **Step 2** Write `lib/api.ts` with a small `request()` helper using `fetch(`${BASE}${path}`, { credentials: 'include', ... })` and the exported functions above. `recognize` uses `FormData` with `file`.
- [ ] **Step 3** Add `.env.example` with `NEXT_PUBLIC_API_BASE_URL=http://localhost:8080`.
- [ ] **Step 4: Verify build** — `npm run build`; expect success.
- [ ] **Step 5: Commit** — `git add types/index.ts lib/api.ts .env.example && git commit -m "feat(frontend): add backend API client and confidence/source types"`

### Task 14: Client-side image downscale

**Files:**
- Create: `lib/image.ts`, `lib/image.test.ts` (only if a JS test runner is added; otherwise verify via a temporary page). Since the repo has no test runner, verify manually in Step 3.

**Interfaces:**
- `downscale(file: File, maxEdge = 768): Promise<Blob>` — draws the image on a canvas scaled so its longest edge ≤ `maxEdge`, exports `image/jpeg` quality 0.9. Returns original if already smaller.

- [ ] **Step 1** Write `lib/image.ts` using `createImageBitmap(file)` + an `OffscreenCanvas`/`<canvas>` and `canvas.toBlob`.
- [ ] **Step 2** Wire `downscale` into `lib/api.ts`'s `recognize` so uploads are downscaled first.
- [ ] **Step 3: Verify** — `npm run dev`, drop a large photo, confirm the network request payload is a downscaled JPEG (DevTools → Network → request size < original).
- [ ] **Step 4: Commit** — `git add lib/image.ts lib/api.ts && git commit -m "feat(frontend): downscale images before upload"`

### Task 15: Login gate (Spotify redirect + Apple MusicKit JS)

**Files:**
- Create: `components/auth/LoginGate.tsx`
- Modify: `app/page.tsx` (render `LoginGate` until a session exists), `app/layout.tsx` (load MusicKit JS script)

**Interfaces:**
- `LoginGate` shows two buttons: **Spotify** → `window.location = `${API}/api/auth/spotify/login``; **Apple Music** → load MusicKit with the developer token from `appleDeveloperToken()`, call `music.authorize()` to get the user token + `storefrontId`, then `appleSession(userToken, storefront)` and reveal the app.
- Session detection: a lightweight `GET /api/session` endpoint returning `{service, market}` or `401`. **Add this endpoint to `backend/app/routes/…` (return `require_session` fields) as Step 1 here**, plus a matching `getSession()` in `lib/api.ts`.

- [ ] **Step 1 (backend)** Add `GET /api/session` returning `{"service": session.service, "market": session.market}` guarded by `require_session`; add `getSession()` to `lib/api.ts`. Commit backend separately.
- [ ] **Step 2** Write `LoginGate.tsx` with the two flows above (Apple uses `window.MusicKit.configure({ developerToken, app: { name: 'Discify', build: '1' } })`).
- [ ] **Step 3** In `app/page.tsx`, call `getSession()` on mount; while `401`, render `LoginGate`; once authenticated, render the existing app.
- [ ] **Step 4** In `app/layout.tsx`, add the MusicKit JS `<script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js" data-web-components async>` (via `next/script`, strategy `afterInteractive`).
- [ ] **Step 5: Verify** — `npm run dev`; Spotify button redirects and returns authenticated; Apple button prompts MusicKit auth. Confirm the app content appears only after login.
- [ ] **Step 6: Commit** — `git add components/auth app/page.tsx app/layout.tsx lib/api.ts && git commit -m "feat(frontend): login-first gate for Spotify and Apple Music"`

### Task 16: Swap recognition mock → real API

**Files:**
- Modify: `hooks/useCDScanner.ts`

**Interfaces:**
- Replace `recognizeCD(usedAlbumIds)` with `api.recognize(cd.file)`. On `{reason}` → set `status: 'error'`. On `Album` → set `status: 'done'`, `album`, and `source: 'auto'`. Keep the existing `MAX_CONCURRENT = 2` queue untouched.

- [ ] **Step 1** Edit `useCDScanner.ts`: import `recognize` from `lib/api`, replace the `recognizeCD(...)` promise with `recognize(cd.file)`, branch on `'reason' in result`.
- [ ] **Step 2: Verify** — `npm run dev` (backend running, logged in), drop a CD photo, confirm a real album with tracklist renders; drop a non-CD image, confirm the error state.
- [ ] **Step 3: Commit** — `git add hooks/useCDScanner.ts && git commit -m "feat(frontend): use real recognition endpoint"`

### Task 17: Swap playlist mock → real API + result UI

**Files:**
- Modify: `hooks/usePlaylist.ts`, `components/modals/SuccessModal.tsx`, `components/playlist/PlaylistPanel.tsx`

**Interfaces:**
- `createPlaylist` calls `api.createPlaylist(name, detectedAlbums.map(cd => cd.album))`; store `{playlistUrl, missed}` in state; drive `isSuccess` from the resolved response (remove the `setTimeout`).
- `SuccessModal` shows the real `playlistUrl` (a link/button) and, if `missed.length`, "N tracks weren't available on {service}".

- [ ] **Step 1** Edit `usePlaylist.ts`: replace the `setTimeout` mock with the awaited `api.createPlaylist(...)`; add `playlistUrl` + `missed` to state; set `isCreating` around the call; handle errors → surface a retryable error state.
- [ ] **Step 2** Update `SuccessModal.tsx` + `PlaylistPanel.tsx` to render `playlistUrl` and `missed`.
- [ ] **Step 3: Verify** — end-to-end: scan → create → real playlist opens in the service; confirm any unavailable tracks are reported.
- [ ] **Step 4: Commit** — `git add hooks/usePlaylist.ts components/modals/SuccessModal.tsx components/playlist/PlaylistPanel.tsx && git commit -m "feat(frontend): create real playlists and show results"`

### Task 18: Confidence badge + manual override

**Files:**
- Modify: `components/album/AlbumCard.tsx`
- Create: `components/album/AlbumEditor.tsx`

**Interfaces:**
- `AlbumCard` shows a "Not sure?" badge when `album.confidence < 0.6` and an always-available "Edit" button.
- `AlbumEditor` — text input → `api.searchAlbums(q)` (debounced) → candidate list; selecting a candidate calls the parent's `onReplace(cd.id, album)`, which sets the CD's `album`, `status: 'done'`, `source: 'manual'`, `confidence: 1`.
- Add `replaceAlbum(id, album)` to `usePlaylist.ts` and thread `onReplace` through `AlbumGrid` → `AlbumCard`.

- [ ] **Step 1** Add `replaceAlbum(id, album)` to `usePlaylist.ts` (sets album/source/status) and expose it; thread it through `app/page.tsx` → `AlbumGrid` → `AlbumCard`.
- [ ] **Step 2** Write `AlbumEditor.tsx` (debounced search calling `api.searchAlbums`, candidate list with cover + title + artist).
- [ ] **Step 3** Update `AlbumCard.tsx`: confidence badge + "Edit" toggling `AlbumEditor`. Also fall back to the scanned CD's `previewUrl` as the cover image when `album.coverUrl` is null/empty (spec §8).
- [ ] **Step 4: Verify** — force a low-confidence detection, confirm the badge; edit any card, search, pick a replacement, confirm the grid + totals update and it's marked manual.
- [ ] **Step 5: Commit** — `git add components/album hooks/usePlaylist.ts app/page.tsx && git commit -m "feat(frontend): confidence badges and manual album override"`

---

## Phase 5 — Deploy & end-to-end verification

### Task 19: Containerize, deploy to Cloud Run, wire secrets, verify

**Files:**
- Create: `backend/Dockerfile`, `backend/.dockerignore`, `backend/.env.example`, `docs/deploy.md`

**Interfaces:** none (ops).

- [ ] **Step 1** Write `backend/Dockerfile` (python:3.12-slim, install from `pyproject.toml`, `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]`).
- [ ] **Step 2** Write `backend/.env.example` documenting every env var: `GEMINI_MODEL`, `VERTEX_PROJECT`, `VERTEX_LOCATION`, `FRONTEND_ORIGIN`, `BACKEND_ORIGIN`, `SESSION_SECRET`, `CONFIDENCE_THRESHOLD`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`.
- [ ] **Step 3** Write `docs/deploy.md`: create Secret Manager secrets; grant the Cloud Run service account Vertex AI User; `gcloud run deploy discify-api --source backend --set-secrets ...`; set `FRONTEND_ORIGIN`/`BACKEND_ORIGIN`; register the Spotify redirect URI (`{BACKEND_ORIGIN}/api/auth/spotify/callback`) and Apple domain association.
- [ ] **Step 4** Set `NEXT_PUBLIC_API_BASE_URL` to the deployed URL in the frontend host (Vercel/Cloud Run).
- [ ] **Step 5: Verify end-to-end** — from the deployed frontend: log in (both services), scan real CD photos, override one, create a playlist, confirm it appears in the streaming account. Record results in `docs/deploy.md`.
- [ ] **Step 5b: Accuracy pass (golden set, spec §14)** — run ~10 known CD photos through the deployed `/api/recognize` and record the `{artist, title}` hit rate in `docs/deploy.md`. This is the recognition-accuracy regression baseline; re-run it when the model id or prompt changes.
- [ ] **Step 6: Commit** — `git add backend/Dockerfile backend/.dockerignore backend/.env.example docs/deploy.md && git commit -m "chore(deploy): Cloud Run container, secrets, and deploy guide"`

---

## Notes for the executor

- **TDD everywhere it's testable:** all backend tasks follow write-test → fail → implement → pass → commit. Frontend tasks (no test runner in this repo) use explicit manual verification steps instead — do not skip them.
- **Provider request/response shapes:** the Spotify and Apple tasks include working mocked tests, but confirm exact live field names against the linked official docs when implementing the real HTTP calls — provider payloads drift.
- **Model id:** confirm the exact `gemini-3.1-flash-lite` id in Vertex Model Garden before first real call; it's already env-driven so this is config-only.
- **Do not** add a database, ADK, or LangChain (Global Constraints).
