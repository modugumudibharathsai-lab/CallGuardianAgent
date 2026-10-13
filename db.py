"""SQLite storage for CallGuardianAI.

Standard library only. Stores caller NAME (no phone numbers), call outcomes and
per-turn analysis. Also stores user accounts, sessions, and CAPTCHA challenges.
Never stores API keys. All queries are parameterized.
"""
import hashlib
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

DB_PATH = Path(os.getenv("CALLGUARDIAN_DB_PATH", Path(__file__).parent / "callguardian.db"))

OUTCOMES = ("AI handled", "Transferred", "Declined")
SOURCES = ("rule_sensitive", "gemini", "gemini_scam_override")
REDACTED_CALLER_MESSAGE = "[Sensitive caller message redacted]"

# Auth constants
SESSION_TTL_HOURS = 24
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15
CAPTCHA_TTL_MINUTES = 10

SCHEMA = """
CREATE TABLE IF NOT EXISTS calls (
    id           INTEGER PRIMARY KEY,          -- the frontend's active.id (ms timestamp)
    caller_name  TEXT NOT NULL DEFAULT 'Unknown caller',
    started_at   TEXT NOT NULL,                -- UTC ISO-8601
    ended_at     TEXT,                         -- NULL = abandoned / still open
    outcome      TEXT CHECK (outcome IN ('AI handled','Transferred','Declined')),
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS turns (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id                   INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    turn_no                   INTEGER NOT NULL,
    caller_message            TEXT NOT NULL,
    reply                     TEXT NOT NULL,
    summary                   TEXT NOT NULL,
    intent                    TEXT NOT NULL,
    urgency                   TEXT NOT NULL CHECK (urgency IN ('Low','Medium','High')),
    risk                      TEXT NOT NULL CHECK (risk IN ('Low','Medium','High')),
    review_required           INTEGER NOT NULL CHECK (review_required IN (0,1)),
    suggested_action          TEXT NOT NULL CHECK (suggested_action IN ('accept','decline','transfer')),
    sensitive_info_requested  INTEGER NOT NULL CHECK (sensitive_info_requested IN (0,1)),
    source                    TEXT NOT NULL CHECK (source IN ('rule_sensitive','gemini','gemini_scam_override')),
    latency_ms                INTEGER,
    created_at                TEXT NOT NULL,
    UNIQUE (call_id, turn_no)
);
CREATE INDEX IF NOT EXISTS idx_turns_call ON turns(call_id);
CREATE INDEX IF NOT EXISTS idx_calls_started ON calls(started_at);

-- ── Auth tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT NOT NULL COLLATE NOCASE,
    email           TEXT NOT NULL COLLATE NOCASE,
    password_hash   TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    TEXT,                        -- NULL = not locked
    UNIQUE (username),
    UNIQUE (email)
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,            -- SHA-256(raw_token) stored here
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    ip          TEXT,
    user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_token   ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS captcha_challenges (
    id         TEXT PRIMARY KEY,                 -- random UUID-style id sent to client
    question   TEXT NOT NULL,
    answer     INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_captcha_expires ON captcha_challenges(expires_at);
"""

# ── Migration: add user_id column to pre-existing calls table ─────────────────
_MIGRATION_ADD_USER_ID = """
ALTER TABLE calls ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
"""


@contextmanager
def _conn():
    """One short-lived connection per operation: commit on success, roll back on error."""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        with conn:  # transaction
            yield conn
    finally:
        conn.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _iso_from_ms(ms) -> str:
    """Convert the frontend's millisecond id to ISO time; fall back to now if implausible."""
    try:
        dt = datetime.fromtimestamp(int(ms) / 1000, timezone.utc)
        if 2020 <= dt.year <= 2100 and dt <= datetime.now(timezone.utc):
            return dt.isoformat(timespec="seconds")
    except (TypeError, ValueError, OverflowError, OSError):
        pass
    return _now()


def _name(value) -> str:
    return (str(value).strip()[:80] if value else "") or "Unknown caller"


def init_db() -> None:
    """Create the database file and tables if they do not exist yet.
    Also runs additive migrations for existing databases.
    """
    with _conn() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        # Migration: add user_id to calls if it does not exist yet
        existing = {row[1] for row in conn.execute("PRAGMA table_info(calls)")}
        if "user_id" not in existing:
            conn.execute(_MIGRATION_ADD_USER_ID)
        # Purge expired captcha rows on startup to keep the table small
        conn.execute(
            "DELETE FROM captcha_challenges WHERE expires_at < ?", (_now(),)
        )


def _ensure_call(conn, call_id: int, caller_name=None, started_at_ms=None,
                 user_id: int | None = None) -> None:
    call_id = int(call_id)
    if user_id is None:
        conn.execute(
            "INSERT OR IGNORE INTO calls (id, caller_name, started_at) VALUES (?, ?, ?)",
            (call_id, _name(caller_name), _iso_from_ms(started_at_ms if started_at_ms else call_id)),
        )
        return

    conn.execute(
        """INSERT OR IGNORE INTO calls (id, caller_name, started_at, user_id)
           VALUES (?, ?, ?, ?)""",
        (call_id, _name(caller_name), _iso_from_ms(started_at_ms if started_at_ms else call_id),
         int(user_id)),
    )
    owner = conn.execute("SELECT user_id FROM calls WHERE id = ?", (call_id,)).fetchone()
    if not owner or owner["user_id"] != int(user_id):
        raise PermissionError("Call does not belong to the authenticated user.")


# ══════════════════════════════════════════════════════════════════════════════
# Auth helpers
# ══════════════════════════════════════════════════════════════════════════════

def _hash_token(raw: str) -> str:
    """SHA-256 of the raw session token — what we store in the DB."""
    return hashlib.sha256(raw.encode()).hexdigest()


# ── CAPTCHA ───────────────────────────────────────────────────────────────────

def create_captcha() -> dict:
    """Generate a simple arithmetic challenge. Returns {id, question}."""
    a, b = secrets.randbelow(11) + 2, secrets.randbelow(11) + 2
    ops = [('+', a + b), ('-', a - b), ('×', a * b)]
    op_sym, answer = secrets.choice(ops)
    question = f"{a} {op_sym} {b}"
    challenge_id = secrets.token_urlsafe(24)
    expires = (
        _now_dt() + timedelta(minutes=CAPTCHA_TTL_MINUTES)
    ).isoformat(timespec="seconds")
    with _conn() as conn:
        conn.execute(
            "INSERT INTO captcha_challenges (id, question, answer, expires_at, used) VALUES (?,?,?,?,0)",
            (challenge_id, question, answer, expires),
        )
    return {"id": challenge_id, "question": f"{question} = ?"}


def verify_captcha(challenge_id: str, user_answer: int) -> bool:
    """Verify once; marks challenge as used. Returns True on success.

    Uses a raw connection with isolation_level=EXCLUSIVE so that the
    SELECT + UPDATE are atomic without nesting a BEGIN inside the
    _conn() context manager (which already manages its own transaction).
    """
    conn = sqlite3.connect(DB_PATH, timeout=10, isolation_level="EXCLUSIVE")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        row = conn.execute(
            "SELECT answer, expires_at, used FROM captcha_challenges WHERE id = ?",
            (challenge_id,),
        ).fetchone()
        if not row:
            conn.rollback()
            return False
        if row["used"] or row["expires_at"] < _now():
            conn.execute("DELETE FROM captcha_challenges WHERE id = ?", (challenge_id,))
            conn.commit()
            return False
        conn.execute(
            "UPDATE captcha_challenges SET used = 1 WHERE id = ?", (challenge_id,)
        )
        conn.commit()
        return int(row["answer"]) == int(user_answer)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def purge_expired_captchas() -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM captcha_challenges WHERE expires_at < ?", (_now(),))


# ── Users ─────────────────────────────────────────────────────────────────────

def create_user(username: str, email: str, password_hash: str) -> int:
    """Insert a new user. Raises sqlite3.IntegrityError on duplicate username/email."""
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO users (username, email, password_hash, created_at) VALUES (?,?,?,?)",
            (username.strip(), email.strip().lower(), password_hash, _now()),
        )
        return cur.lastrowid


def get_user_by_username(username: str) -> dict | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ?", (username.strip(),)
        ).fetchone()
        return dict(row) if row else None


def get_user_by_email(email: str) -> dict | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ?", (email.strip().lower(),)
        ).fetchone()
        return dict(row) if row else None


def get_user_by_id(user_id: int) -> dict | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE id = ?", (int(user_id),)
        ).fetchone()
        return dict(row) if row else None


def record_failed_attempt(user_id: int) -> dict:
    """Increment failed login counter; lock account after MAX_FAILED_ATTEMPTS."""
    with _conn() as conn:
        conn.execute(
            "UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ?",
            (int(user_id),),
        )
        row = conn.execute(
            "SELECT failed_attempts FROM users WHERE id = ?", (int(user_id),)
        ).fetchone()
        attempts = row["failed_attempts"]
        locked_until = None
        if attempts >= MAX_FAILED_ATTEMPTS:
            locked_until = (
                _now_dt() + timedelta(minutes=LOCKOUT_MINUTES)
            ).isoformat(timespec="seconds")
            conn.execute(
                "UPDATE users SET locked_until = ? WHERE id = ?",
                (locked_until, int(user_id)),
            )
        return {"attempts": attempts, "locked_until": locked_until}


def clear_failed_attempts(user_id: int) -> None:
    with _conn() as conn:
        conn.execute(
            "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?",
            (int(user_id),),
        )


def is_account_locked(user: dict) -> bool:
    """True if the account is currently in the lockout window."""
    if not user.get("locked_until"):
        return False
    return user["locked_until"] > _now()


# ── Sessions ──────────────────────────────────────────────────────────────────

def create_session(user_id: int, ip: str | None, user_agent: str | None) -> str:
    """Create a session and return the raw (unhashed) token to set in the cookie."""
    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    now_dt = _now_dt()
    expires = (now_dt + timedelta(hours=SESSION_TTL_HOURS)).isoformat(timespec="seconds")
    with _conn() as conn:
        conn.execute(
            """INSERT INTO sessions (user_id, token_hash, created_at, expires_at, ip, user_agent)
               VALUES (?,?,?,?,?,?)""",
            (int(user_id), token_hash, now_dt.isoformat(timespec="seconds"),
             expires, ip, user_agent),
        )
    return raw_token


def get_session(raw_token: str) -> dict | None:
    """Look up a valid (non-expired) session. Returns session row or None."""
    token_hash = _hash_token(raw_token)
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?",
            (token_hash, _now()),
        ).fetchone()
        return dict(row) if row else None


def delete_session(raw_token: str) -> None:
    """Invalidate one session (logout)."""
    token_hash = _hash_token(raw_token)
    with _conn() as conn:
        conn.execute(
            "DELETE FROM sessions WHERE token_hash = ?", (token_hash,)
        )


def delete_all_sessions(user_id: int) -> None:
    """Invalidate all sessions for a user (e.g. password change)."""
    with _conn() as conn:
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (int(user_id),))


def purge_expired_sessions() -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (_now(),))


def save_turn(call_id: int, caller_message: str, analysis: dict, source: str,
              latency_ms: int | None = None, caller_name: str | None = None,
              user_id: int | None = None) -> int:
    """Store one analyzed exchange. `analysis` is ChatAnalysis.model_dump() from main.py."""
    if source not in SOURCES:
        raise ValueError(f"source must be one of {SOURCES}")
    with _conn() as conn:
        _ensure_call(conn, call_id, caller_name, user_id=user_id)
        turn_no = conn.execute(
            "SELECT COALESCE(MAX(turn_no), 0) + 1 FROM turns WHERE call_id = ?", (int(call_id),)
        ).fetchone()[0]
        cur = conn.execute(
            """INSERT INTO turns (call_id, turn_no, caller_message, reply, summary, intent, urgency, risk,
                                  review_required, suggested_action, sensitive_info_requested, source,
                                  latency_ms, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (int(call_id), turn_no,
             REDACTED_CALLER_MESSAGE if source == "rule_sensitive" else caller_message[:2000],
             analysis["reply"][:4000], analysis["summary"][:1000],
             analysis["intent"][:200], analysis["urgency"], analysis["risk"],
             int(bool(analysis["review_required"])), analysis["suggested_action"],
             int(bool(analysis["sensitive_info_requested"])), source,
             int(latency_ms) if latency_ms is not None else None, _now()),
        )
        return cur.lastrowid


def complete_call(call_id: int, outcome: str, caller_name: str | None = None,
                  user_id: int | None = None) -> bool:
    """Record how the call really ended. Returns False if it was already completed."""
    if outcome not in OUTCOMES:
        raise ValueError(f"outcome must be one of {OUTCOMES}")
    with _conn() as conn:
        _ensure_call(conn, call_id, caller_name, user_id=user_id)
        cur = conn.execute(
            "UPDATE calls SET outcome = ?, ended_at = ? WHERE id = ? AND outcome IS NULL",
            (outcome, _now(), int(call_id)),
        )
        return cur.rowcount == 1


def get_call(call_id: int, user_id: int | None = None) -> dict | None:
    """Return one call with its turns, optionally restricted to its owner."""
    with _conn() as conn:
        if user_id is None:
            call = conn.execute("SELECT * FROM calls WHERE id = ?", (int(call_id),)).fetchone()
        else:
            call = conn.execute(
                "SELECT * FROM calls WHERE id = ? AND user_id = ?",
                (int(call_id), int(user_id)),
            ).fetchone()
        if not call:
            return None
        turns = conn.execute("SELECT * FROM turns WHERE call_id = ? ORDER BY turn_no", (int(call_id),)).fetchall()
        return {**dict(call), "turns": [dict(t) for t in turns]}


def get_recent_calls(limit: int = 50, user_id: int | None = None) -> list[dict]:
    """Return the most recent calls with their turns, ordered by started_at DESC.
    When user_id is given, only that user's calls are returned.
    """
    limit = max(1, min(int(limit), 100))
    with _conn() as conn:
        if user_id is not None:
            calls = [dict(r) for r in conn.execute(
                "SELECT * FROM calls WHERE user_id = ? ORDER BY started_at DESC, id DESC LIMIT ?",
                (int(user_id), limit)
            ).fetchall()]
        else:
            calls = [dict(r) for r in conn.execute(
                "SELECT * FROM calls ORDER BY started_at DESC, id DESC LIMIT ?", (limit,)
            ).fetchall()]
        if not calls:
            return []
        call_ids = [c["id"] for c in calls]
        placeholders = ",".join("?" for _ in call_ids)
        turns = [dict(r) for r in conn.execute(
            f"SELECT * FROM turns WHERE call_id IN ({placeholders}) ORDER BY call_id, turn_no", call_ids
        ).fetchall()]
    by_call = {}
    for t in turns:
        by_call.setdefault(t["call_id"], []).append(t)
    for c in calls:
        c["turns"] = by_call.get(c["id"], [])
    return calls


def _rate(n, d):
    return None if not d else round(n / d, 3)


def analytics_summary(days: int = 7, user_id: int | None = None) -> dict:
    """Metrics calculated from stored rows only. Rates are None (not 0) when there is no data to divide by.
    When user_id is given, only that user's calls are included.
    """
    from datetime import timedelta
    days = max(1, min(int(days), 90))
    lvl = {1: "Low", 2: "Medium", 3: "High"}
    score = "CASE {c} WHEN 'High' THEN 3 WHEN 'Medium' THEN 2 ELSE 1 END"
    today = datetime.now(timezone.utc).date()
    day_list = [(today - timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]
    uid_filter = "AND c.user_id = ?" if user_id is not None else ""
    uid_args = (int(user_id),) if user_id is not None else ()
    with _conn() as conn:
        def one(sql, *a):
            return conn.execute(sql, a).fetchone()[0]
        calls_total = conn.execute(
            f"SELECT COUNT(*) FROM calls c WHERE 1=1 {uid_filter}", uid_args
        ).fetchone()[0]
        completed = conn.execute(
            f"SELECT COUNT(*) FROM calls c WHERE outcome IS NOT NULL {uid_filter}", uid_args
        ).fetchone()[0]
        turns_total = conn.execute(
            f"SELECT COUNT(*) FROM turns t JOIN calls c ON c.id = t.call_id WHERE 1=1 {uid_filter}",
            uid_args
        ).fetchone()[0]
        outcomes = {o: 0 for o in OUTCOMES}
        outcomes.update({r[0]: r[1] for r in conn.execute(
            f"SELECT c.outcome, COUNT(*) FROM calls c WHERE c.outcome IS NOT NULL {uid_filter} GROUP BY c.outcome",
            uid_args)})
        per_day = {r[0]: r[1] for r in conn.execute(
            f"SELECT substr(c.started_at,1,10), COUNT(*) FROM calls c WHERE substr(c.started_at,1,10) >= ? {uid_filter} GROUP BY 1",
            (day_list[0],) + uid_args)}
        per_call = conn.execute(
            f"""SELECT t.call_id, c.outcome,
                       MAX({score.format(c='t.risk')}), MAX({score.format(c='t.urgency')}),
                       MAX(t.review_required), MAX(t.sensitive_info_requested),
                       MAX(t.source = 'gemini_scam_override')
                FROM turns t JOIN calls c ON c.id = t.call_id WHERE 1=1 {uid_filter} GROUP BY t.call_id""",
            uid_args).fetchall()
        last_actions = conn.execute(
            f"""SELECT c.outcome, t.suggested_action FROM turns t
               JOIN (SELECT call_id, MAX(turn_no) m FROM turns GROUP BY call_id) x
                 ON t.call_id = x.call_id AND t.turn_no = x.m
               JOIN calls c ON c.id = t.call_id WHERE c.outcome IS NOT NULL {uid_filter}""",
            uid_args).fetchall()
        intents = conn.execute(
            f"""SELECT t.intent, COUNT(*) FROM turns t JOIN calls c ON c.id = t.call_id WHERE 1=1 {uid_filter}
                GROUP BY t.intent ORDER BY COUNT(*) DESC, t.intent LIMIT 5""",
            uid_args).fetchall()
        sources = {r[0]: r[1] for r in conn.execute(
            f"SELECT t.source, COUNT(*) FROM turns t JOIN calls c ON c.id = t.call_id WHERE 1=1 {uid_filter} GROUP BY t.source",
            uid_args)}
        avg_latency = conn.execute(
            f"SELECT AVG(t.latency_ms) FROM turns t JOIN calls c ON c.id = t.call_id WHERE t.latency_ms IS NOT NULL AND t.source != 'rule_sensitive' {uid_filter}",
            uid_args).fetchone()[0]
        avg_duration = conn.execute(
            f"SELECT AVG((julianday(c.ended_at) - julianday(c.started_at)) * 86400) FROM calls c WHERE c.ended_at IS NOT NULL {uid_filter}",
            uid_args).fetchone()[0]

    analysed = len(per_call)
    risk = {v: 0 for v in lvl.values()}; urg = dict(risk)
    for _, _, r, u, *_ in per_call:
        risk[lvl[r]] += 1; urg[lvl[u]] += 1
    agree_map = {"accept": "AI handled", "decline": "Declined", "transfer": "Transferred"}
    matches = sum(1 for outcome, action in last_actions if agree_map[action] == outcome)
    return {
        "empty": calls_total == 0,
        "generated_at": _now(),
        "totals": {"calls": calls_total, "completed": completed, "abandoned": calls_total - completed,
                   "turns": turns_total, "calls_with_analysis": analysed},
        "outcomes": outcomes,
        "calls_per_day": [{"date": d, "calls": per_day.get(d, 0)} for d in day_list],
        "call_risk": risk,
        "call_urgency": urg,
        "top_intents": [{"intent": i, "turns": n} for i, n in intents],
        "review_required_rate": _rate(sum(1 for r in per_call if r[4]), analysed),
        "sensitive_info_calls": sum(1 for r in per_call if r[5]),
        "scam_override_calls": sum(1 for r in per_call if r[6]),
        "declined_high_risk_calls": sum(1 for r in per_call if r[1] == "Declined" and r[2] == 3),
        "turn_sources": sources,
        "action_agreement": {"matches": matches, "compared": len(last_actions), "rate": _rate(matches, len(last_actions))},
        "avg_turns_per_call": _rate(turns_total, analysed) if analysed else None,
        "avg_gemini_latency_ms": None if avg_latency is None else round(avg_latency),
        "avg_call_duration_seconds": None if avg_duration is None else round(avg_duration, 1),
    }


# ---------------- Exports ----------------
CALL_COLUMNS = ["call_id", "caller_name", "started_at", "ended_at", "outcome", "turn_count", "highest_risk",
                "highest_urgency", "review_required", "sensitive_info_requested", "last_suggested_action"]
TURN_COLUMNS = ["call_id", "turn_no", "created_at", "caller_name", "call_outcome", "caller_message", "reply",
                "summary", "intent", "urgency", "risk", "review_required", "suggested_action",
                "sensitive_info_requested", "source", "latency_ms"]
_LEVEL = {"Low": 1, "Medium": 2, "High": 3}


def export_calls(user_id: int | None = None) -> list[dict]:
    """Every call with its turns nested inside (used for the JSON export).
    When user_id is given, only that user's calls are returned.
    """
    uid_filter = "WHERE c.user_id = ?" if user_id is not None else ""
    uid_args = (int(user_id),) if user_id is not None else ()
    with _conn() as conn:
        calls = [dict(r) for r in conn.execute(
            f"SELECT * FROM calls c {uid_filter} ORDER BY started_at, id", uid_args
        )]
        if not calls:
            return []
        call_ids = [c["id"] for c in calls]
        placeholders = ",".join("?" for _ in call_ids)
        turns = [dict(r) for r in conn.execute(
            f"SELECT * FROM turns WHERE call_id IN ({placeholders}) ORDER BY call_id, turn_no",
            call_ids,
        )]
    by_call: dict = {}
    for t in turns:
        by_call.setdefault(t["call_id"], []).append(t)
    for c in calls:
        c["turns"] = by_call.get(c["id"], [])
    return calls


def calls_csv_rows(user_id: int | None = None) -> list[dict]:
    """One row per call, with values calculated from its turns."""
    rows = []
    for c in export_calls(user_id=user_id):
        t = c["turns"]
        rows.append({
            "call_id": c["id"], "caller_name": c["caller_name"], "started_at": c["started_at"],
            "ended_at": c["ended_at"], "outcome": c["outcome"], "turn_count": len(t),
            "highest_risk": max((x["risk"] for x in t), key=_LEVEL.get) if t else None,
            "highest_urgency": max((x["urgency"] for x in t), key=_LEVEL.get) if t else None,
            "review_required": int(any(x["review_required"] for x in t)) if t else None,
            "sensitive_info_requested": int(any(x["sensitive_info_requested"] for x in t)) if t else None,
            "last_suggested_action": t[-1]["suggested_action"] if t else None,
        })
    return rows


def turns_csv_rows(user_id: int | None = None) -> list[dict]:
    """One row per analysed turn, with the call's name and outcome.
    When user_id is given, only that user's turns are returned.
    """
    uid_filter = "AND c.user_id = ?" if user_id is not None else ""
    uid_args = (int(user_id),) if user_id is not None else ()
    with _conn() as conn:
        return [dict(r) for r in conn.execute(
            f"""SELECT t.*, c.caller_name, c.outcome AS call_outcome FROM turns t
               JOIN calls c ON c.id = t.call_id WHERE 1=1 {uid_filter}
               ORDER BY t.call_id, t.turn_no""",
            uid_args,
        )]


def csv_cell(value):
    """Stop spreadsheets from running caller-supplied text as a formula (=, +, -, @ at the start)."""
    if isinstance(value, str) and (value[:1] in ("\t", "\r", "\n") or value.lstrip()[:1] in ("=", "+", "-", "@")):
        return "'" + value
    return value


def to_csv(rows: list[dict], columns: list[str]) -> str:
    """CSV text with a UTF-8 BOM so Excel shows non-English characters correctly."""
    import csv, io
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(columns)
    for r in rows:
        w.writerow([csv_cell(r.get(c)) for c in columns])
    return "\ufeff" + buf.getvalue()
