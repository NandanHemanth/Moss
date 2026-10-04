"""Memory layer 3 — SQLite. System of record: users, raw events, insights, proposals, approvals, audit."""
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

from .config import settings

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None
JSON_COLS = {"participants", "meta", "params", "result"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT, role TEXT, title TEXT, email TEXT);
CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, name TEXT, kind TEXT, summary TEXT);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, source TEXT, agent_id TEXT, title TEXT, body TEXT, summary TEXT,
  occurred_at TEXT, account TEXT, participants TEXT, url TEXT, meta TEXT, importance INTEGER DEFAULT 0, processed INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS insights(id TEXT PRIMARY KEY, event_id TEXT, kind TEXT, text TEXT, owner TEXT, due TEXT);
CREATE TABLE IF NOT EXISTS commitments(id TEXT PRIMARY KEY, event_id TEXT, text TEXT, owner TEXT, due TEXT,
  status TEXT DEFAULT 'open', agent_id TEXT, account TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY, event_id TEXT, created_at TEXT, status TEXT DEFAULT 'pending');
CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY, proposal_id TEXT, agent_id TEXT, kind TEXT, title TEXT, detail TEXT,
  params TEXT, status TEXT DEFAULT 'pending', result TEXT, requested_by TEXT, decided_by TEXT, decided_at TEXT, position INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, agent_id TEXT, text TEXT, created_at TEXT, event_id TEXT);
CREATE TABLE IF NOT EXISTS facts(id TEXT PRIMARY KEY, subject TEXT, subject_type TEXT, predicate TEXT, object TEXT, object_type TEXT,
  fact TEXT, event_id TEXT, valid_at TEXT, account TEXT);
CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, tool TEXT, kind TEXT, payload TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, ts TEXT, user_id TEXT, action TEXT, detail TEXT);
CREATE INDEX IF NOT EXISTS ix_events_time ON events(occurred_at);
CREATE INDEX IF NOT EXISTS ix_facts_subject ON facts(subject);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        settings.db_path.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(settings.db_path, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.executescript(SCHEMA)
    return _conn


def reset() -> None:
    """Drop every table. Used by the seeder and tests."""
    global _conn
    with _lock:
        c = conn()
        for (name,) in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
            c.execute(f"DROP TABLE IF EXISTS {name}")
        c.commit()
        c.executescript(SCHEMA)


def _row(r: sqlite3.Row) -> dict:
    d = dict(r)
    for k in JSON_COLS & d.keys():
        d[k] = json.loads(d[k]) if d[k] else None
    return d


def q(sql: str, params: tuple | list = ()) -> list[dict]:
    with _lock:
        return [_row(r) for r in conn().execute(sql, params).fetchall()]


def one(sql: str, params: tuple | list = ()) -> dict | None:
    rows = q(sql, params)
    return rows[0] if rows else None


def x(sql: str, params: tuple | list = ()) -> None:
    with _lock:
        conn().execute(sql, params)
        conn().commit()


def insert(table: str, row: dict, replace: bool = False) -> dict:
    data = {k: (json.dumps(v) if k in JSON_COLS and v is not None else v) for k, v in row.items()}
    verb = "INSERT OR REPLACE" if replace else "INSERT OR IGNORE"
    x(f"{verb} INTO {table}({','.join(data)}) VALUES({','.join('?' * len(data))})", list(data.values()))
    return row


def update(table: str, row_id: str, fields: dict) -> None:
    data = {k: (json.dumps(v) if k in JSON_COLS and v is not None else v) for k, v in fields.items()}
    x(f"UPDATE {table} SET {','.join(f'{k}=?' for k in data)} WHERE id=?", [*data.values(), row_id])


def audit(user_id: str, action: str, detail: str = "") -> None:
    insert("audit", {"id": new_id("aud"), "ts": now(), "user_id": user_id, "action": action, "detail": detail})
