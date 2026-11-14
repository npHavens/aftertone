from __future__ import annotations

import asyncio
import re
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx
import jwt

from .core import Problem

# Spotify Development Mode has no batch track lookup, so preflight checks a few tracks at a time.
VALIDATION_CONCURRENCY = 8
APPLE_SERVER_TOKEN_LIFETIME = 3600
# MusicKit can't swap a configured token, so the origin-limited browser token must outlast
# any open page. Apple allows developer tokens up to six months.
APPLE_BROWSER_TOKEN_LIFETIME = 30 * 86400
UNCERTAIN_PUBLISH = (
    "Publishing may have partially succeeded. Check your music library before trying a new "
    "publish. This operation will not replay any writes."
)
PREFLIGHT_FAILED = (
    "Track checks failed before anything was written. Review your selection and try again."
)


def unavailable_track():
    return Problem("unavailable_track", "A selected track is unavailable. Review your selection.")


def spotify_track_available(track, track_id):
    if track.get("is_playable") is False or track.get("restrictions"):
        return False
    same_track = (
        track.get("id") == track_id or (track.get("linked_from") or {}).get("id") == track_id
    )
    # Spotify may relink to a playable equivalent in the user's market. Development Mode
    # responses no longer include linked_from, so is_playable is the remaining signal.
    return same_track or track.get("is_playable") is True


class Providers:
    def __init__(self, settings, store):
        self.settings = settings
        self.store = store
        self.http = httpx.AsyncClient(timeout=30, follow_redirects=False)
        self.refresh_lock = asyncio.Lock()
        self.apple_tokens = {}

    def developer_token(self, browser=False):
        if not self.settings.capabilities()["appleMusic"]:
            raise Problem(
                "setup_required",
                "Configure Apple Music developer credentials and server encryption key.",
                503,
            )
        audience = "browser" if browser else "server"
        cached = self.apple_tokens.get(audience)
        if cached and cached["expires"] - 300 > time.time():
            return cached["token"]
        now = int(time.time())
        lifetime = APPLE_BROWSER_TOKEN_LIFETIME if browser else APPLE_SERVER_TOKEN_LIFETIME
        claims = {"iss": self.settings.apple_team, "iat": now, "exp": now + lifetime}
        if browser:
            # MusicKit's token is limited to this app. Server calls send no Origin header,
            # so they use an unrestricted token that never reaches the browser.
            claims["origin"] = [self.settings.origin]
        try:
            token = jwt.encode(
                claims,
                Path(self.settings.apple_private_path).read_text(),
                algorithm="ES256",
                headers={"kid": self.settings.apple_key},
            )
        except Exception:
            raise Problem("setup_required", "Apple Music signing key could not be loaded.", 503)
        self.apple_tokens[audience] = {"token": token, "expires": now + lifetime}
        return token

    async def send(self, method, url, **kwargs):
        try:
            response = await self.http.request(method, url, **kwargs)
        except httpx.HTTPError:
            raise Problem(
                "upstream_unavailable", "The music service did not return a response.", 502, True
            )
        if response.status_code == 400 and url == "https://accounts.spotify.com/api/token":
            raise Problem(
                "provider_authorization", "Spotify authorization expired. Reconnect Spotify.", 401
            )
        if response.status_code == 429:
            raise Problem(
                "rate_limited",
                "The music service rate limit was reached. Try again later.",
                429,
                True,
            )
        if response.status_code in (401, 403):
            raise Problem(
                "provider_authorization",
                "Reconnect your music service or check account access and subscription.",
                401,
            )
        if response.status_code >= 400:
            raise Problem(
                "provider_rejected"
                if response.status_code < 500 and response.status_code != 408
                else "provider_error",
                "The music service could not complete this request.",
                502,
                response.status_code >= 500,
            )
        try:
            return response.json() if response.content else {}
        except ValueError:
            raise Problem("provider_error", "The music service returned an invalid response.", 502)

    def current_data(self, session):
        current = self.store.get_by_id(session["id"])
        if not current:
            raise Problem(
                "unauthenticated", "Your session expired. Reconnect your music service.", 401
            )
        session["data"] = current["data"]
        return current["data"]

    async def request(self, session, method, path, **kwargs):
        if session["data"]["service"] == "spotify":
            async with self.refresh_lock:
                # Re-read under the lock so concurrent calls see a token another call refreshed.
                data = self.current_data(session)
                if data.get("expires", 0) <= time.time() + 60:
                    try:
                        token = await self.send(
                            "POST",
                            "https://accounts.spotify.com/api/token",
                            data={
                                "grant_type": "refresh_token",
                                "refresh_token": data["refresh_token"],
                                "client_id": self.settings.spotify_id,
                            },
                        )
                    except Problem as error:
                        error.write_not_started = True
                        raise
                    if not token.get("access_token") or not isinstance(
                        token.get("expires_in"), (int, float)
                    ):
                        raise Problem(
                            "provider_authorization",
                            "Spotify did not return a valid authorization. Reconnect.",
                            401,
                        )
                    data.update(
                        access_token=token["access_token"],
                        expires=time.time() + token["expires_in"],
                        refresh_token=token.get("refresh_token", data["refresh_token"]),
                    )
                    self.store.save(session)
            base = "https://api.spotify.com/v1"
            headers = {"Authorization": "Bearer " + data["access_token"]}
        else:
            data = self.current_data(session)
            base = "https://api.music.apple.com"
            headers = {
                "Authorization": "Bearer " + self.developer_token(),
                "Music-User-Token": data["user_token"],
            }
        if path.startswith("https://"):
            if urlparse(path).netloc != urlparse(base).netloc:
                raise Problem("provider_error", "Invalid catalog pagination URL.", 502)
            url = path
        else:
            url = base + path
        return await self.send(method, url, headers=headers, **kwargs)

    def album_shape(self, item, service):
        if service == "spotify":
            return {
                "id": item["id"],
                "service": service,
                "title": item["name"],
                "artist": ", ".join(artist["name"] for artist in item.get("artists", [])),
                "artworkUrl": next((image["url"] for image in item.get("images", [])), None),
                "url": item.get("external_urls", {}).get("spotify"),
                "tracks": [],
            }
        attributes = item["attributes"]
        art = attributes.get("artwork", {}).get("url")
        return {
            "id": item["id"],
            "service": service,
            "title": attributes["name"],
            "artist": attributes.get("artistName", ""),
            "artworkUrl": art.replace("{w}", "400").replace("{h}", "400") if art else None,
            "url": attributes.get("url"),
            "tracks": [],
        }

    def track_shape(self, track, service):
        if service == "spotify":
            return {
                "id": track["id"],
                "title": track["name"],
                "artist": ", ".join(artist["name"] for artist in track.get("artists", [])),
                "durationMs": track.get("duration_ms"),
                "url": track.get("external_urls", {}).get("spotify"),
            }
        attributes = track["attributes"]
        return {
            "id": track["id"],
            "title": attributes["name"],
            "artist": attributes.get("artistName", ""),
            "durationMs": attributes.get("durationInMillis"),
            "url": attributes.get("url"),
        }

    def playable_track(self, track, service):
        # Offer only what preflight will accept, so a confirmed album can always be published.
        if service == "spotify":
            return spotify_track_available(track, track["id"])
        # Album track lists can include music videos, which are not playlist songs.
        return track.get("type") == "songs" and bool(track.get("attributes", {}).get("playParams"))

    async def search(self, session, q, offset=0):
        service = session["data"]["service"]
        if service == "spotify":
            result = await self.request(
                session,
                "GET",
                "/search",
                params={"q": q, "type": "album", "limit": 10, "offset": offset},
            )
            items = result.get("albums", {}).get("items", [])
        else:
            result = await self.request(
                session,
                "GET",
                "/v1/catalog/" + session["data"]["storefront"] + "/search",
                params={"term": q, "types": "albums", "limit": 10, "offset": offset},
            )
            items = result.get("results", {}).get("albums", {}).get("data", [])
        return [self.album_shape(item, service) for item in items]

    async def album(self, session, album_id):
        if not re.fullmatch(r"[A-Za-z0-9.\-]+", album_id):
            raise Problem("invalid_id", "Invalid catalog album ID.")
        service = session["data"]["service"]
        if service == "spotify":
            # The user's market adds is_playable, matching what preflight checks.
            item = await self.request(
                session, "GET", "/albums/" + album_id, params={"market": "from_token"}
            )
            page = item["tracks"]
        else:
            result = await self.request(
                session,
                "GET",
                "/v1/catalog/" + session["data"]["storefront"] + "/albums/" + album_id,
            )
            if not result.get("data"):
                raise Problem("catalog_miss", "Album unavailable in your storefront.", 404)
            item = result["data"][0]
            page = item["relationships"]["tracks"]
        album = self.album_shape(item, service)
        for _ in range(100):
            for track in page.get("items" if service == "spotify" else "data", []):
                if self.playable_track(track, service):
                    album["tracks"].append(self.track_shape(track, service))
            if not page.get("next"):
                return album
            page = await self.request(session, "GET", page["next"])
        raise Problem("provider_error", "Album track pagination exceeded the safety limit.", 502)

    async def validate_tracks(self, session, ids):
        # The workers share one list of tracks, so each finished check starts the next one and a
        # slow track never holds back the ones after it.
        tracks = iter(enumerate(ids))
        failures = []

        async def worker():
            for index, track_id in tracks:
                # After a failure no new check starts.
                if failures:
                    return
                try:
                    await self.validate_track(session, track_id)
                except Exception as error:
                    failures.append((index, error))
                except BaseException as error:
                    # Anything else, such as cancellation, also stops new checks and is still raised.
                    failures.append((index, error))
                    raise

        # A failure doesn't cancel the running checks, because one may be saving a refreshed
        # Spotify token. With return_exceptions, gather also waits for them before an error a
        # worker raised is raised here, so none is left running. KeyboardInterrupt and SystemExit
        # are different: they stop the event loop at once.
        results = await asyncio.gather(
            *(worker() for _ in range(VALIDATION_CONCURRENCY)), return_exceptions=True
        )
        for result in results:
            if isinstance(result, BaseException):
                raise result
        if failures:
            # Report the earliest track's failure, regardless of which check finished first.
            _, error = min(failures)
            raise error

    async def validate_track(self, session, track_id):
        if session["data"]["service"] == "spotify":
            # Without a market, Spotify omits is_playable and restrictions entirely.
            track = await self.request(
                session, "GET", "/tracks/" + track_id, params={"market": "from_token"}
            )
            if not spotify_track_available(track, track_id):
                raise unavailable_track()
            return
        result = await self.request(
            session,
            "GET",
            "/v1/catalog/" + session["data"]["storefront"] + "/songs/" + track_id,
        )
        if (
            not result.get("data")
            or result["data"][0].get("id") != track_id
            or result["data"][0].get("type") != "songs"
            or not result["data"][0].get("attributes", {}).get("playParams")
        ):
            raise unavailable_track()

    def finish(self, op, **changes):
        op.update(changes)
        self.store.save_operation(op)
        return op

    async def publish(self, session, op, payload):
        # Preflight is read-only, so any failure here is definitive and unlocks the draft.
        try:
            await self.validate_tracks(session, payload["trackIds"])
        except Problem as error:
            return self.finish(op, status="failed", message=error.message, code=error.code)
        except asyncio.CancelledError:
            self.finish(op, status="failed", code="cancelled", message=PREFLIGHT_FAILED)
            raise
        except Exception:
            return self.finish(op, status="failed", code="provider_error", message=PREFLIGHT_FAILED)
        service = session["data"]["service"]
        try:
            if service == "spotify":
                result = await self.request(
                    session,
                    "POST",
                    "/me/playlists",
                    json={"name": payload["name"], "public": False},
                )
                op["playlistId"] = result["id"]
                op["playlistUrl"] = (result.get("external_urls") or {}).get("spotify")
            else:
                result = await self.request(
                    session,
                    "POST",
                    "/v1/me/library/playlists",
                    json={"attributes": {"name": payload["name"]}},
                )
                playlist = result["data"][0]
                op["playlistId"] = playlist["id"]
                op["playlistUrl"] = (playlist.get("attributes") or {}).get("url")
            self.store.save_operation(op)
            # Small bounded batches; writes are never automatically retried.
            for start in range(0, len(payload["trackIds"]), 25):
                batch = payload["trackIds"][start : start + 25]
                if service == "spotify":
                    await self.request(
                        session,
                        "POST",
                        "/playlists/" + op["playlistId"] + "/items",
                        json={"uris": ["spotify:track:" + track_id for track_id in batch]},
                    )
                else:
                    await self.request(
                        session,
                        "POST",
                        "/v1/me/library/playlists/" + op["playlistId"] + "/tracks",
                        json={"data": [{"id": track_id, "type": "songs"} for track_id in batch]},
                    )
                op["addedCount"] += len(batch)
                self.store.save_operation(op)
            op["status"] = "completed"
        except Problem as error:
            if not op.get("playlistId") and (
                error.write_not_started
                or error.code
                in {
                    "provider_authorization",
                    "unauthenticated",
                    "setup_required",
                    "rate_limited",
                    "provider_rejected",
                }
            ):
                op.update(status="failed", message=error.message, code=error.code)
            else:
                op.update(status="needs_attention", message=UNCERTAIN_PUBLISH)
        except asyncio.CancelledError:
            op.update(status="needs_attention", message=UNCERTAIN_PUBLISH)
            raise
        except Exception:
            # Any other error may have followed a write, so the outcome is unknown.
            op.update(status="needs_attention", message=UNCERTAIN_PUBLISH)
        finally:
            self.store.save_operation(op)
        return op
