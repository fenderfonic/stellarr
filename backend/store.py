"""Atomic source snapshots. Failed refreshes leave the last successful data available."""

import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path


def db_path():
    return Path(os.environ.get("STELLARR_DB", "data/catalogue.sqlite3"))


def save(source, started, snapshot):
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("""CREATE TABLE IF NOT EXISTS catalogue (
            source TEXT PRIMARY KEY, started INTEGER NOT NULL, snapshot TEXT NOT NULL
        )""")
        db.execute("""INSERT INTO catalogue VALUES (?, ?, ?)
            ON CONFLICT(source) DO UPDATE SET started=excluded.started, snapshot=excluded.snapshot
            WHERE excluded.started >= catalogue.started
        """, (source, started, json.dumps(snapshot, separators=(",", ":"))))


def load():
    path = db_path()
    if not path.exists():
        return {}
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='catalogue'").fetchone():
            return {}
        return {source: json.loads(snapshot) for source, snapshot in
                db.execute("SELECT source, snapshot FROM catalogue ORDER BY source")}
