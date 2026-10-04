"""SQLite store: the durable memory layer.

Each UI resource lives in its own table as a JSON document keyed by integer id, which keeps the
schema aligned with the frontend types without an ORM. Raw source content (emails, threads,
transcripts, pages) lives in `documents` for the agents to search.
"""

import json
import sqlite3
import threading
from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any

from .config import DB_PATH

RESOURCES = (
    "accounts",
    "interactions",
    "commitments",
    "meetings",
    "proposals",
    "updates",
    "risks",
    "agents",
)

_lock = threading.Lock()
_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
_conn.row_factory = sqlite3.Row


def init() -> None:
    with _lock, _conn:
        for name in RESOURCES:
            id_type = "TEXT" if name == "agents" else "INTEGER"
            _conn.execute(f"CREATE TABLE IF NOT EXISTS {name} (id {id_type} PRIMARY KEY, data TEXT NOT NULL)")
        _conn.execute(
            """CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY,
                source TEXT NOT NULL,
                account_id INTEGER,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                occurred_at TEXT NOT NULL,
                meta TEXT NOT NULL DEFAULT '{}'
            )"""
        )
        _conn.execute(
            """CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                at TEXT NOT NULL,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                detail TEXT NOT NULL
            )"""
        )


def _check(resource: str) -> None:
    if resource not in RESOURCES:
        raise KeyError(resource)


def is_empty() -> bool:
    return _conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0


def reset() -> None:
    with _lock, _conn:
        for name in (*RESOURCES, "documents", "audit_log"):
            _conn.execute(f"DELETE FROM {name}")


def insert_many(resource: str, rows: Iterable[dict[str, Any]]) -> None:
    _check(resource)
    with _lock, _conn:
        _conn.executemany(
            f"INSERT INTO {resource} (id, data) VALUES (?, ?)",
            [(row["id"], json.dumps(row)) for row in rows],
        )


def all_rows(resource: str) -> list[dict[str, Any]]:
    _check(resource)
    return [json.loads(r["data"]) for r in _conn.execute(f"SELECT data FROM {resource} ORDER BY id")]


def get(resource: str, id_: int | str) -> dict[str, Any] | None:
    _check(resource)
    row = _conn.execute(f"SELECT data FROM {resource} WHERE id = ?", (id_,)).fetchone()
    return json.loads(row["data"]) if row else None


def create(resource: str, values: dict[str, Any]) -> dict[str, Any]:
    _check(resource)
    with _lock, _conn:
        next_id = _conn.execute(f"SELECT COALESCE(MAX(id), 0) + 1 FROM {resource}").fetchone()[0]
        row = {**values, "id": next_id}
        _conn.execute(f"INSERT INTO {resource} (id, data) VALUES (?, ?)", (next_id, json.dumps(row)))
    return row


def update(resource: str, id_: int | str, values: dict[str, Any]) -> dict[str, Any] | None:
    _check(resource)
    with _lock, _conn:
        current = _conn.execute(f"SELECT data FROM {resource} WHERE id = ?", (id_,)).fetchone()
        if not current:
            return None
        row = {**json.loads(current["data"]), **values, "id": id_}
        _conn.execute(f"UPDATE {resource} SET data = ? WHERE id = ?", (json.dumps(row), id_))
    return row


def delete(resource: str, id_: int | str) -> dict[str, Any] | None:
    row = get(resource, id_)
    if row:
        with _lock, _conn:
            _conn.execute(f"DELETE FROM {resource} WHERE id = ?", (id_,))
    return row


def insert_documents(docs: Iterable[dict[str, Any]]) -> None:
    with _lock, _conn:
        _conn.executemany(
            "INSERT INTO documents (id, source, account_id, title, body, occurred_at, meta) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (d["id"], d["source"], d.get("accountId"), d["title"], d["body"], d["occurredAt"], json.dumps(d.get("meta", {})))
                for d in docs
            ],
        )


def _doc(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "source": row["source"],
        "accountId": row["account_id"],
        "title": row["title"],
        "body": row["body"],
        "occurredAt": row["occurred_at"],
        "meta": json.loads(row["meta"]),
    }


def documents(source: str | None = None, account_id: int | None = None) -> list[dict[str, Any]]:
    sql, args = "SELECT * FROM documents WHERE 1=1", []
    if source:
        sql += " AND source = ?"
        args.append(source)
    if account_id is not None:
        sql += " AND account_id = ?"
        args.append(account_id)
    return [_doc(r) for r in _conn.execute(sql + " ORDER BY occurred_at DESC", args)]


def document(id_: int) -> dict[str, Any] | None:
    row = _conn.execute("SELECT * FROM documents WHERE id = ?", (id_,)).fetchone()
    return _doc(row) if row else None


def audit(actor: str, action: str, detail: dict[str, Any]) -> None:
    with _lock, _conn:
        _conn.execute(
            "INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)",
            (datetime.now(timezone.utc).isoformat(), actor, action, json.dumps(detail)),
        )


def audit_entries(limit: int = 50) -> list[dict[str, Any]]:
    rows = _conn.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,))
    return [{**dict(r), "detail": json.loads(r["detail"])} for r in rows]
