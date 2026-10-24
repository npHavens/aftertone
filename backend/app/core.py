from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

from cryptography.fernet import Fernet
from dotenv import load_dotenv


class Problem(Exception):
    def __init__(self, code, message, status=400, retryable=False):
        self.code, self.message, self.status, self.retryable = code, message, status, retryable
        self.write_not_started = False


@dataclass
class Settings:
    origin: str = "http://127.0.0.1:3000"
    redirect: str = "http://127.0.0.1:3000/api/auth/spotify/callback"
    spotify_id: str = ""
    encryption_key: str = ""
    apple_team: str = ""
    apple_key: str = ""
    apple_private_path: str = ""
    project: str = ""
    location: str = ""
    model: str = ""
    vertex_verified: bool = False
    store_path: str = ".local/aftertone.sqlite3"
    ttl: int = 86400

    @classmethod
    def env(cls):
        load_dotenv(Path(__file__).resolve().parents[1] / ".env")
        return cls(
            origin=os.getenv("FRONTEND_ORIGIN", cls.origin),
            redirect=os.getenv("SPOTIFY_REDIRECT_URI", cls.redirect),
            spotify_id=os.getenv("SPOTIFY_CLIENT_ID", ""),
            encryption_key=os.getenv("TOKEN_ENCRYPTION_KEY", ""),
            apple_team=os.getenv("APPLE_TEAM_ID", ""),
            apple_key=os.getenv("APPLE_KEY_ID", ""),
            apple_private_path=os.getenv("APPLE_PRIVATE_KEY_PATH", ""),
            project=os.getenv("GOOGLE_CLOUD_PROJECT", ""),
            location=os.getenv("GOOGLE_CLOUD_LOCATION", ""),
            model=os.getenv("GEMINI_MODEL", ""),
            vertex_verified=os.getenv("VERTEX_ACCESS_VERIFIED") == "true",
            store_path=os.getenv("STORE_PATH", cls.store_path),
            ttl=int(os.getenv("SESSION_TTL_SECONDS", "86400")),
        )

    def capabilities(self):
        key = bool(self.encryption_key)
        return {
            "spotify": key
            and bool(self.spotify_id)
            and self.redirect == self.origin + "/api/auth/spotify/callback",
            "appleMusic": key and all([self.apple_team, self.apple_key, self.apple_private_path]),
            "recognition": bool(
                self.project
                and self.location
                and self.model
                and "pro" in self.model.lower()
                and self.vertex_verified
            ),
        }


class Store:
    def __init__(self, settings):
        self.settings = settings
        path = Path(settings.store_path)
        if not path.is_absolute():
            path = Path(__file__).resolve().parents[1] / path
        path.parent.mkdir(parents=True, exist_ok=True)
        # Anonymous local sessions work without setup. Provider authorization never uses this ephemeral key.
        self.cipher = Fernet(
            settings.encryption_key.encode() if settings.encryption_key else Fernet.generate_key()
        )
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, expires REAL, csrf TEXT, data TEXT);
        CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, owner TEXT, idem TEXT, digest TEXT, expires REAL, data TEXT, UNIQUE(owner,idem));
        """)
        self.db.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
        self.db.execute("DELETE FROM operations WHERE owner NOT IN (SELECT id FROM sessions)")
        # A process interrupted during a write cannot safely replay it on startup.
        for row in self.db.execute("SELECT id,data FROM operations").fetchall():
            data = json.loads(row["data"])
            if data["status"] == "processing":
                data.update(
                    status="needs_attention",
                    message="The local server stopped during publishing. Check your music library before creating another playlist.",
                )
                self.save_operation(data)

    @staticmethod
    def digest(raw):
        return hashlib.sha256(raw.encode()).hexdigest()

    def create(self, data=None):
        raw, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        sid = self.digest(raw)
        self.db.execute(
            "INSERT INTO sessions VALUES (?,?,?,?)",
            (sid, time.time() + self.settings.ttl, csrf, self.encrypt(data or {})),
        )
        return raw, {"id": sid, "csrf": csrf, "data": data or {}}

    def encrypt(self, data):
        return self.cipher.encrypt(json.dumps(data).encode()).decode()

    def get(self, raw):
        if not raw:
            return None
        row = self.db.execute(
            "SELECT * FROM sessions WHERE id=? AND expires>?", (self.digest(raw), time.time())
        ).fetchone()
        if not row:
            return None
        try:
            return {
                "id": row["id"],
                "csrf": row["csrf"],
                "data": json.loads(self.cipher.decrypt(row["data"].encode())),
            }
        except Exception:
            return None

    def save(self, session):
        self.db.execute(
            "UPDATE sessions SET data=? WHERE id=?", (self.encrypt(session["data"]), session["id"])
        )

    def delete(self, sid):
        self.db.execute("DELETE FROM sessions WHERE id=?", (sid,))
        self.db.execute("DELETE FROM operations WHERE owner=?", (sid,))

    def begin_operation(self, owner, idem, payload):
        digest = self.digest(json.dumps(payload, sort_keys=True, separators=(",", ":")))
        op = {"id": secrets.token_urlsafe(18), "status": "processing", "addedCount": 0}
        self.db.execute("BEGIN IMMEDIATE")
        try:
            existing = self.db.execute(
                "SELECT * FROM operations WHERE owner=? AND idem=?", (owner, idem)
            ).fetchone()
            if existing:
                if existing["expires"] <= time.time():
                    raise Problem(
                        "operation_expired",
                        "This publish record expired. Check your music library before publishing again.",
                        410,
                    )
                if existing["digest"] != digest:
                    raise Problem(
                        "idempotency_conflict",
                        "This publish key was already used for a different playlist.",
                        409,
                    )
                self.db.execute("COMMIT")
                return json.loads(existing["data"]), False
            self.db.execute(
                "INSERT INTO operations VALUES (?,?,?,?,?,?)",
                (op["id"], owner, idem, digest, time.time() + 86400, json.dumps(op)),
            )
            self.db.execute("COMMIT")
            return op, True
        except Exception:
            if self.db.in_transaction:
                self.db.execute("ROLLBACK")
            raise

    def save_operation(self, op):
        self.db.execute("UPDATE operations SET data=? WHERE id=?", (json.dumps(op), op["id"]))
