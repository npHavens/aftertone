import io
import time

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from PIL import Image

from app.core import Settings
from app.main import COOKIE, create_app, normalize_image


@pytest.fixture
def setup(tmp_path):
    settings = Settings(
        store_path=str(tmp_path / "store.sqlite3"),
        encryption_key=Fernet.generate_key().decode(),
        spotify_id="test",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        yield app, client


def csrf(client):
    return {
        "Origin": "http://127.0.0.1:3000",
        "X-CSRF-Token": client.get("/api/session").json()["csrfToken"],
    }


def connect(app, client):
    raw, session = app.state.store.create(
        {
            "service": "spotify",
            "access_token": "SECRET_ACCESS",
            "refresh_token": "SECRET_REFRESH",
            "expires": time.time() + 3600,
        }
    )
    client.cookies.set(COOKIE, raw)
    return session


def test_cookie_csrf_and_disconnect(setup):
    app, client = setup
    response = client.get("/api/session")
    assert response.json()["authenticated"] is False
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=lax" in response.headers["set-cookie"]
    assert client.delete("/api/session").status_code == 403
    headers = csrf(client)
    assert (
        client.delete(
            "/api/session", headers={**headers, "Origin": "https://evil.test"}
        ).status_code
        == 403
    )
    assert client.delete("/api/session", headers=headers).status_code == 200


def test_credentials_encrypted_expired_and_tampered(setup):
    app, client = setup
    session = connect(app, client)
    assert (
        "SECRET"
        not in app.state.store.db.execute(
            "SELECT data FROM sessions WHERE id=?", (session["id"],)
        ).fetchone()["data"]
    )
    assert "SECRET" not in client.get("/api/session").text
    app.state.store.db.execute("UPDATE sessions SET expires=0")
    assert client.get("/api/session").json()["authenticated"] is False
    client.cookies.set(COOKIE, "tampered")
    assert client.get("/api/session").json()["authenticated"] is False


def test_oauth_state_is_one_use(setup):
    app, client = setup
    client.get("/api/session")
    response = client.get("/api/auth/spotify/login", follow_redirects=False)
    assert "code_challenge_method=S256" in response.headers["location"]
    session = app.state.store.get(client.cookies.get(COOKIE))
    state = session["data"]["oauth"]["state"]
    assert (
        client.get(
            "/api/auth/spotify/callback",
            params={"state": state, "error": "access_denied"},
            follow_redirects=False,
        ).status_code
        == 307
    )
    assert (
        client.get(
            "/api/auth/spotify/callback", params={"state": state, "code": "unused"}
        ).status_code
        == 400
    )


def test_images_reject_invalid_and_strip_metadata():
    from app.core import Problem

    with pytest.raises(Problem):
        normalize_image(b"not image")
    with pytest.raises(Problem):
        normalize_image(b"x" * (10 * 1024 * 1024 + 1))
    output = io.BytesIO()
    Image.new("RGB", (8, 8)).save(output, "PNG")
    result = normalize_image(output.getvalue())
    assert Image.open(io.BytesIO(result)).format == "JPEG"


def test_publish_idempotency_uncertain_and_ownership(setup):
    app, client = setup
    connect(app, client)
    calls = []

    def upstream(request):
        calls.append((request.method, request.url.path))
        if request.method == "GET":
            return httpx.Response(200, json={"id": "track1", "is_playable": True})
        if request.url.path == "/v1/me/playlists":
            return httpx.Response(
                201,
                json={
                    "id": "playlist1",
                    "external_urls": {"spotify": "https://open.spotify.com/playlist/playlist1"},
                },
            )
        raise httpx.ReadTimeout("uncertain append", request=request)

    app.state.providers.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    headers = {**csrf(client), "Idempotency-Key": "unique-key-123"}
    payload = {"name": "Test", "trackIds": ["track1", "track1"]}
    first = client.post("/api/playlists", json=payload, headers=headers)
    assert first.status_code == 200
    operation = first.json()
    assert operation["status"] == "needs_attention"
    assert operation["playlistId"] == "playlist1"
    assert operation["addedCount"] == 0
    count = len(calls)
    assert client.post("/api/playlists", json=payload, headers=headers).json() == operation
    assert len(calls) == count
    assert (
        client.post(
            "/api/playlists", json={**payload, "name": "Different"}, headers=headers
        ).status_code
        == 409
    )
    connect(app, client)
    assert client.get("/api/playlist-operations/" + operation["id"]).status_code == 404


def test_preflight_failure_never_creates_playlist(setup):
    app, client = setup
    connect(app, client)
    calls = []

    def upstream(request):
        calls.append(request.method)
        return httpx.Response(403, json={})

    app.state.providers.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    result = client.post(
        "/api/playlists",
        json={"name": "Test", "trackIds": ["track1"]},
        headers={**csrf(client), "Idempotency-Key": "unique-key-123"},
    )
    assert result.json()["status"] == "failed"
    assert calls == ["GET"]


VERIFIED_VERTEX = {
    "project": "nhs-aftertone",
    "location": "global",
    "model": "gemini-4-argon",
    "vertex_verified": True,
}


@pytest.mark.parametrize("model", ["gemini-4-argon", "gemini-3.1-pro-preview"])
def test_recognition_uses_the_explicitly_configured_model(model):
    settings = Settings(**{**VERIFIED_VERTEX, "model": model})
    assert settings.capabilities()["recognition"] is True


@pytest.mark.parametrize(
    "incomplete",
    [{"project": ""}, {"location": ""}, {"model": ""}, {"vertex_verified": False}],
)
def test_recognition_stays_off_until_vertex_is_fully_configured(incomplete):
    settings = Settings(**{**VERIFIED_VERTEX, **incomplete})
    assert settings.capabilities()["recognition"] is False


def test_setup_gates_and_input_validation(setup):
    app, client = setup
    connect(app, client)
    headers = csrf(client)
    assert (
        client.post("/api/recognize", files={"file": ("x.jpg", b"fake")}, headers=headers).json()[
            "code"
        ]
        == "setup_required"
    )
    assert (
        client.post(
            "/api/playlists",
            json={"name": "Test", "trackIds": ["../../evil"]},
            headers={**headers, "Idempotency-Key": "unique-key-123"},
        ).status_code
        == 400
    )
    assert client.get("/api/auth/apple/developer-token").json()["code"] == "setup_required"


def test_session_scope_and_expired_mutation(setup):
    app, client = setup
    first = client.get("/api/session").json()
    assert first["sessionScope"] == client.get("/api/session").json()["sessionScope"]
    assert first["sessionScope"] != client.cookies.get(COOKIE)
    app.state.store.db.execute("UPDATE sessions SET expires=0")
    response = client.post("/api/playlists", headers={"Origin": "http://127.0.0.1:3000"})
    assert response.status_code == 401
    assert response.json()["code"] == "unauthenticated"
    assert client.get("/api/session").json()["sessionScope"] != first["sessionScope"]


def test_expired_operation_cannot_replay(setup):
    app, client = setup
    session = connect(app, client)
    payload = {"name": "Test", "trackIds": ["track1"]}
    op, _ = app.state.store.begin_operation(session["id"], "expired-key", payload)
    app.state.store.db.execute("UPDATE operations SET expires=0")
    response = client.post(
        "/api/playlists", json=payload, headers={**csrf(client), "Idempotency-Key": "expired-key"}
    )
    assert response.status_code == 410
    assert response.json()["code"] == "operation_expired"
    assert client.get("/api/playlist-operations/" + op["id"]).status_code == 404


@pytest.mark.parametrize(
    "status, expected",
    [
        (400, "failed"),
        (401, "failed"),
        (429, "failed"),
        (500, "needs_attention"),
        (408, "needs_attention"),
    ],
)
def test_create_failure_classification(setup, status, expected):
    app, client = setup
    connect(app, client)

    def upstream(request):
        if request.method == "GET":
            return httpx.Response(200, json={"id": "track1"})
        return httpx.Response(status, json={})

    app.state.providers.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    response = client.post(
        "/api/playlists",
        json={"name": "Test", "trackIds": ["track1"]},
        headers={**csrf(client), "Idempotency-Key": "create-key"},
    )
    assert response.json()["status"] == expected
    assert response.json()["addedCount"] == 0


@pytest.mark.parametrize("service", ["spotify", "apple-music"])
def test_partial_publish_retains_checkpoint_without_replay(setup, service):
    app, client = setup
    raw, _ = app.state.store.create(
        {
            "service": service,
            "access_token": "access",
            "refresh_token": "refresh",
            "expires": time.time() + 3600,
            "user_token": "apple",
            "storefront": "us",
        }
    )
    client.cookies.set(COOKIE, raw)
    app.state.providers.developer_token = lambda: "developer"
    writes = []
    url = "https://example.test/playlist"

    def upstream(request):
        if request.method == "GET":
            track_id = request.url.path.rsplit("/", 1)[-1]
            if service == "spotify":
                return httpx.Response(200, json={"id": track_id})
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "id": track_id,
                            "type": "songs",
                            "attributes": {"playParams": {"id": track_id}},
                        }
                    ]
                },
            )
        writes.append(request.url.path)
        if len(writes) == 1:
            return httpx.Response(
                201,
                json={"id": "p1", "external_urls": {"spotify": url}}
                if service == "spotify"
                else {"data": [{"id": "p1", "attributes": {"url": url}}]},
            )
        if len(writes) == 2:
            return httpx.Response(204)
        raise httpx.ReadTimeout("unknown write", request=request)

    app.state.providers.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    payload = {"name": "Test", "trackIds": [str(i) for i in range(30)]}
    headers = {**csrf(client), "Idempotency-Key": "partial-key"}
    result = client.post("/api/playlists", json=payload, headers=headers).json()
    assert result["status"] == "needs_attention"
    assert result["addedCount"] == 25
    assert result["playlistUrl"] == url
    assert client.post("/api/playlists", json=payload, headers=headers).json() == result
    assert len(writes) == 3


def test_spotify_refresh_rotates_and_reuses_token(setup):
    app, client = setup
    session = connect(app, client)
    session["data"]["expires"] = 0
    app.state.store.save(session)
    refreshes = []

    def upstream(request):
        if request.url.host == "accounts.spotify.com":
            refreshes.append(request.content)
            return httpx.Response(
                200,
                json={
                    "access_token": "new-access",
                    "refresh_token": "new-refresh",
                    "expires_in": 3600,
                },
            )
        assert request.headers["authorization"] == "Bearer new-access"
        return httpx.Response(200, json={"albums": {"items": []}})

    app.state.providers.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    assert client.get("/api/albums/search?q=test").status_code == 200
    assert client.get("/api/albums/search?q=test").status_code == 200
    assert len(refreshes) == 1
    stored = app.state.store.get(client.cookies.get(COOKIE))
    assert stored["data"]["refresh_token"] == "new-refresh"


def test_apple_expired_authorization_requests_reconnect(setup):
    app, client = setup
    raw, _ = app.state.store.create(
        {"service": "apple-music", "user_token": "expired", "storefront": "us"}
    )
    client.cookies.set(COOKIE, raw)
    app.state.providers.developer_token = lambda: "developer"
    app.state.providers.http = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(401))
    )
    response = client.get("/api/albums/search?q=test")
    assert response.status_code == 401
    assert response.json()["code"] == "provider_authorization"


def test_catalog_mismatch_is_failed_before_write(setup):
    app, client = setup
    connect(app, client)
    calls = []

    def upstream(request):
        calls.append(request.method)
        return httpx.Response(200, json={"id": "wrong-track"})

    app.state.providers.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    response = client.post(
        "/api/playlists",
        json={"name": "Test", "trackIds": ["track1"]},
        headers={**csrf(client), "Idempotency-Key": "mismatch-key"},
    )
    assert response.json()["status"] == "failed"
    assert response.json()["code"] == "unavailable_track"
    assert calls == ["GET"]


@pytest.mark.parametrize("service", ["spotify", "apple-music"])
def test_album_tracks_include_next_page(setup, service):
    app, client = setup
    raw, _ = app.state.store.create(
        {
            "service": service,
            "access_token": "access",
            "expires": time.time() + 3600,
            "user_token": "apple",
            "storefront": "us",
        }
    )
    client.cookies.set(COOKIE, raw)
    app.state.providers.developer_token = lambda: "developer"
    paths = []

    def upstream(request):
        paths.append(request.url.path)
        if service == "spotify":
            if len(paths) == 1:
                return httpx.Response(
                    200,
                    json={
                        "id": "album1",
                        "name": "Album",
                        "tracks": {
                            "items": [{"id": "t1", "name": "First"}],
                            "next": "https://api.spotify.com/v1/albums/album1/tracks?offset=1",
                        },
                    },
                )
            return httpx.Response(
                200, json={"items": [{"id": "t2", "name": "Second"}], "next": None}
            )
        if len(paths) == 1:
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "id": "album1",
                            "attributes": {"name": "Album"},
                            "relationships": {
                                "tracks": {
                                    "data": [{"id": "t1", "attributes": {"name": "First"}}],
                                    "next": "/v1/catalog/us/albums/album1/tracks?offset=1",
                                }
                            },
                        }
                    ]
                },
            )
        return httpx.Response(200, json={"data": [{"id": "t2", "attributes": {"name": "Second"}}]})

    app.state.providers.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    response = client.get("/api/albums/album1")
    assert [track["id"] for track in response.json()["tracks"]] == ["t1", "t2"]
    assert len(paths) == 2


def test_spotify_expired_refresh_requests_reconnect_without_catalog_call(setup):
    app, client = setup
    session = connect(app, client)
    session["data"]["expires"] = 0
    app.state.store.save(session)
    calls = []

    def upstream(request):
        calls.append(request.url.host)
        return httpx.Response(400, json={"error": "invalid_grant"})

    app.state.providers.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    response = client.get("/api/albums/search?q=test")
    assert response.status_code == 401
    assert response.json()["code"] == "provider_authorization"
    assert calls == ["accounts.spotify.com"]


def test_refresh_failure_before_create_is_definitively_failed(setup):
    app, client = setup
    session = connect(app, client)
    calls = []

    def upstream(request):
        calls.append((request.method, request.url.host))
        if request.method == "GET":
            session["data"]["expires"] = 0
            app.state.store.save(session)
            return httpx.Response(200, json={"id": "track1"})
        assert request.url.host == "accounts.spotify.com"
        raise httpx.ReadTimeout("refresh unavailable", request=request)

    app.state.providers.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    response = client.post(
        "/api/playlists",
        json={"name": "Test", "trackIds": ["track1"]},
        headers={**csrf(client), "Idempotency-Key": "refresh-failure-key"},
    )
    assert response.json()["status"] == "failed"
    assert response.json()["addedCount"] == 0
    assert calls == [("GET", "api.spotify.com"), ("POST", "accounts.spotify.com")]


def test_apple_session_revoked_during_preflight_prevents_creation(setup):
    app, client = setup
    raw, session = app.state.store.create(
        {"service": "apple-music", "user_token": "apple", "storefront": "us"}
    )
    client.cookies.set(COOKIE, raw)
    app.state.providers.developer_token = lambda: "developer"
    calls = []

    def upstream(request):
        calls.append(request.method)
        app.state.store.db.execute("UPDATE sessions SET expires=0 WHERE id=?", (session["id"],))
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "track1",
                        "type": "songs",
                        "attributes": {"playParams": {"id": "track1"}},
                    }
                ]
            },
        )

    app.state.providers.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    response = client.post(
        "/api/playlists",
        json={"name": "Test", "trackIds": ["track1"]},
        headers={**csrf(client), "Idempotency-Key": "revoked-key"},
    )
    assert response.json()["status"] == "failed"
    assert response.json()["code"] == "unauthenticated"
    assert calls == ["GET"]


def test_malformed_creation_metadata_preserves_id_and_uncertainty(setup):
    app, client = setup
    connect(app, client)
    calls = []

    def upstream(request):
        calls.append(request.method)
        if request.method == "GET":
            return httpx.Response(200, json={"id": "track1"})
        return httpx.Response(201, json={"id": "p1", "external_urls": "invalid metadata"})

    app.state.providers.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    response = client.post(
        "/api/playlists",
        json={"name": "Test", "trackIds": ["track1"]},
        headers={**csrf(client), "Idempotency-Key": "malformed-key"},
    )
    assert response.json()["status"] == "needs_attention"
    assert response.json()["playlistId"] == "p1"
    assert calls == ["GET", "POST"]
