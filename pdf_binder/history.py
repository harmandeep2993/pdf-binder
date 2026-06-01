import sqlite3, json, threading
from pathlib import Path
from datetime import datetime

_ROOT       = Path(__file__).parent.parent
_DB_PATH    = _ROOT / "history.db"
_OUTPUT_DIR = _ROOT / "output"
_lock       = threading.Lock()

# Cap stored merges so generated PDFs don't accumulate on disk indefinitely.
_MAX_HISTORY = 50


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(str(_DB_PATH))
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    _OUTPUT_DIR.mkdir(exist_ok=True)
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS merges (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                filename   TEXT    NOT NULL,
                file_path  TEXT    NOT NULL,
                sources    TEXT    NOT NULL,
                pages      INTEGER NOT NULL,
                size       INTEGER NOT NULL,
                created_at TEXT    NOT NULL
            )
        """)


def insert_merge(filename: str, file_path: str, sources: list, pages: int, size: int) -> int:
    with _lock, _conn() as c:
        cur = c.execute(
            "INSERT INTO merges (filename, file_path, sources, pages, size, created_at) VALUES (?,?,?,?,?,?)",
            (filename, str(file_path), json.dumps(sources), pages, size,
             datetime.now().isoformat(timespec="seconds"))
        )
        new_id = cur.lastrowid
        _prune(c)
        return new_id


def _prune(c: sqlite3.Connection) -> None:
    """Delete rows (and their files) beyond the _MAX_HISTORY most recent."""
    stale = c.execute(
        "SELECT id, file_path FROM merges ORDER BY id DESC LIMIT -1 OFFSET ?",
        (_MAX_HISTORY,),
    ).fetchall()
    for row in stale:
        try:
            Path(row["file_path"]).unlink(missing_ok=True)
        except OSError:
            pass
        c.execute("DELETE FROM merges WHERE id = ?", (row["id"],))


def list_merges() -> list:
    with _conn() as c:
        rows = c.execute("SELECT * FROM merges ORDER BY id DESC LIMIT 100").fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["sources"] = json.loads(d["sources"])
            result.append(d)
        return result


def get_merge(id: int) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM merges WHERE id = ?", (id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["sources"] = json.loads(d["sources"])
        return d


def delete_merge(id: int) -> str | None:
    with _lock, _conn() as c:
        row = c.execute("SELECT file_path FROM merges WHERE id = ?", (id,)).fetchone()
        if not row:
            return None
        c.execute("DELETE FROM merges WHERE id = ?", (id,))
        return row["file_path"]
