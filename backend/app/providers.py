from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx
import jwt

from .core import Problem


class Providers:
    def __init__(self, settings, store):
        self.settings, self.store = settings, store
        self.http = httpx.AsyncClient(timeout=30, follow_redirects=False)
        self.refresh_lock = asyncio.Lock()

    def developer_token(self):
        if not self.settings.capabilities()["appleMusic"]:
            raise Problem(
                "setup_required",
                "Configure Apple Music developer credentials and server encryption key.",
                503,
            )
        try:
            now = int(time.time())
            return jwt.encode(
                {
                    "iss": self.settings.apple_team,
                    "iat": now,
                    "exp": now + 3600,
                    "origin": self.settings.origin,
                },
                Path(self.settings.apple_private_path).read_text(),
                algorithm="ES256",
                headers={"kid": self.settings.apple_key},
            )
        except Exception:
            raise Problem("setup_required", "Apple Music signing key could not be loaded.", 503)

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

    async def request(self, session, method, path, **kwargs):
        active = self.store.db.execute(
            "SELECT id FROM sessions WHERE id=? AND expires>?",
            (session["id"], time.time()),
        ).fetchone()
        if not active:
            raise Problem(
                "unauthenticated", "Your session expired. Reconnect your music service.", 401
            )
        data = session["data"]
        if data["service"] == "spotify":
            async with self.refresh_lock:
                current = self.store.db.execute(
                    "SELECT data FROM sessions WHERE id=? AND expires>?",
                    (session["id"], time.time()),
                ).fetchone()
                if not current:
                    raise Problem(
                        "unauthenticated",
                        "Your session expired. Reconnect your music service.",
                        401,
                    )
                data = json.loads(self.store.cipher.decrypt(current["data"].encode()))
                session["data"] = data
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
                "artist": ", ".join(a["name"] for a in item.get("artists", [])),
                "artworkUrl": next((i["url"] for i in item.get("images", [])), None),
                "url": item.get("external_urls", {}).get("spotify"),
                "tracks": [],
            }
        a = item["attributes"]
        art = a.get("artwork", {}).get("url")
        return {
            "id": item["id"],
            "service": service,
            "title": a["name"],
            "artist": a.get("artistName", ""),
            "artworkUrl": art.replace("{w}", "400").replace("{h}", "400") if art else None,
            "url": a.get("url"),
            "tracks": [],
        }

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
        return [self.album_shape(x, service) for x in items]

    async def album(self, session, album_id):
        if not re.fullmatch(r"[A-Za-z0-9.\-]+", album_id):
            raise Problem("invalid_id", "Invalid catalog album ID.")
        service = session["data"]["service"]
        if service == "spotify":
            item = await self.request(session, "GET", "/albums/" + album_id)
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
                a = track if service == "spotify" else track["attributes"]
                album["tracks"].append(
                    {
                        "id": track["id"],
                        "title": a["name"],
                        "artist": ", ".join(x["name"] for x in a.get("artists", []))
                        if service == "spotify"
                        else a.get("artistName", ""),
                        "durationMs": a.get(
                            "duration_ms" if service == "spotify" else "durationInMillis"
                        ),
                        "url": a.get("external_urls", {}).get("spotify")
                        if service == "spotify"
                        else a.get("url"),
                    }
                )
            if not page.get("next"):
                return album
            page = await self.request(session, "GET", page["next"])
        raise Problem("provider_error", "Album track pagination exceeded the safety limit.", 502)

    async def validate_tracks(self, session, ids):
        service = session["data"]["service"]
        for track_id in ids:
            if service == "spotify":
                track = await self.request(session, "GET", "/tracks/" + track_id)
                if (
                    (
                        track.get("id") != track_id
                        and track.get("linked_from", {}).get("id") != track_id
                    )
                    or track.get("is_playable") is False
                    or track.get("restrictions")
                ):
                    raise Problem(
                        "unavailable_track",
                        "A selected track is unavailable. Review your selection.",
                    )
            else:
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
                    raise Problem(
                        "unavailable_track",
                        "A selected track is unavailable. Review your selection.",
                    )

    async def publish(self, session, op, payload):
        # Preflight is read-only; only definitive rejected writes may unlock a draft.
        try:
            await self.validate_tracks(session, payload["trackIds"])
        except Problem as error:
            op.update(status="failed", message=error.message, code=error.code)
            self.store.save_operation(op)
            return op
        except (KeyError, IndexError, TypeError, AttributeError):
            op.update(
                status="failed",
                code="provider_error",
                message="The music service returned invalid track details. Review your selection and try again.",
            )
            self.store.save_operation(op)
            return op
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
            for i in range(0, len(payload["trackIds"]), 25):
                batch = payload["trackIds"][i : i + 25]
                if service == "spotify":
                    await self.request(
                        session,
                        "POST",
                        "/playlists/" + op["playlistId"] + "/items",
                        json={"uris": ["spotify:track:" + x for x in batch]},
                    )
                else:
                    await self.request(
                        session,
                        "POST",
                        "/v1/me/library/playlists/" + op["playlistId"] + "/tracks",
                        json={"data": [{"id": x, "type": "songs"} for x in batch]},
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
                op.update(
                    status="needs_attention",
                    message="Publishing may have partially succeeded. Check your music library before trying a new publish. This operation will not replay any writes.",
                )
        except (KeyError, IndexError, TypeError, AttributeError):
            op.update(
                status="needs_attention",
                message="Publishing may have partially succeeded. Check your music library before trying a new publish. This operation will not replay any writes.",
            )
        finally:
            self.store.save_operation(op)
        return op
