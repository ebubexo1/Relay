"""SQLite storage (stdlib sqlite3). One file: backend/relay.db. No ORM, no extra deps."""
import os
import sqlite3
import threading

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.environ.get('RELAY_DB', os.path.join(BASE_DIR, 'relay.db'))
UPLOAD_DIR = os.path.join(BASE_DIR, 'uploads')
os.makedirs(UPLOAD_DIR, exist_ok=True)

_lock = threading.Lock()


def connect():
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    con = connect()
    cur = con.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role TEXT NOT NULL,               -- personal | payer | admin
            phone TEXT DEFAULT '',
            email TEXT DEFAULT '',
            name TEXT DEFAULT '',
            pin_hash TEXT DEFAULT '',
            pin_salt TEXT DEFAULT '',
            relay_id TEXT DEFAULT '',
            created_at INTEGER DEFAULT 0,
            UNIQUE(phone, role)
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS businesses (
            user_id INTEGER PRIMARY KEY,
            name TEXT DEFAULT '',
            rc TEXT DEFAULT '',
            type TEXT DEFAULT 'employer',
            verified INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS workers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            payer_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            phone TEXT DEFAULT '',
            email TEXT DEFAULT '',
            salary REAL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS escrows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            payer_id INTEGER NOT NULL,
            purpose TEXT DEFAULT '',
            amount REAL DEFAULT 0,
            beneficiary TEXT DEFAULT '',
            partner TEXT DEFAULT '',
            release_cond TEXT DEFAULT '',
            status TEXT DEFAULT 'locked',
            created_at INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            payer_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            mime TEXT DEFAULT '',
            size INTEGER DEFAULT 0,
            path TEXT DEFAULT '',
            created_at INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS requests (
            id TEXT PRIMARY KEY,
            issuer_id INTEGER,
            kind TEXT DEFAULT 'trusted',
            issuer_type TEXT DEFAULT '',
            issuer_name TEXT DEFAULT '',
            escrow_ref TEXT DEFAULT '',
            settlement TEXT DEFAULT '',
            note TEXT DEFAULT '',
            to_name TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            email TEXT DEFAULT '',
            amount REAL DEFAULT 0,
            ref TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            created_at INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS promises (
            id TEXT PRIMARY KEY,
            owner_id INTEGER,                 -- recipient user if phone-matched
            issuer_id INTEGER,
            issuer_name TEXT DEFAULT '',
            issuer_type TEXT DEFAULT '',
            to_name TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            email TEXT DEFAULT '',
            amount REAL DEFAULT 0,
            remaining REAL DEFAULT 0,
            kind TEXT DEFAULT 'trusted',
            settlement TEXT DEFAULT '',
            escrow_ref TEXT DEFAULT '',
            ref TEXT DEFAULT '',
            status TEXT DEFAULT 'verified',   -- verified | settled
            health TEXT DEFAULT 'healthy',
            accepted INTEGER DEFAULT 1,       -- 0 = awaiting recipient accept
            chain TEXT DEFAULT '[]',          -- JSON edges [{from,to,amount}]
            created_at INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS transfers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            promise_id TEXT NOT NULL,
            frm TEXT DEFAULT '',
            to_name TEXT DEFAULT '',
            amount REAL DEFAULT 0,
            seq INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS auctions (
            id TEXT PRIMARY KEY,
            promise_id TEXT NOT NULL,
            seller_id INTEGER,
            status TEXT DEFAULT 'open',       -- open | closed
            winner_bid_id INTEGER,
            created_at INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS bids (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            auction_id TEXT NOT NULL,
            bidder_id INTEGER,                -- LP user id (NULL = house? never: seeded providers)
            bidder_name TEXT DEFAULT '',
            amount REAL DEFAULT 0,
            discount REAL DEFAULT 0,
            response_ms INTEGER DEFAULT 0,
            status TEXT DEFAULT 'submitted',  -- submitted | accepted | rejected
            created_at INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS holdings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lp_id INTEGER NOT NULL,
            claim_label TEXT DEFAULT '',
            face REAL DEFAULT 0,
            paid REAL DEFAULT 0,
            settlement TEXT DEFAULT '',
            created_at INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            amount REAL DEFAULT 0,
            description TEXT DEFAULT '',
            kind TEXT DEFAULT 'settled',
            created_at INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            user_id INTEGER,
            phone TEXT DEFAULT '',
            text TEXT DEFAULT '',
            kind TEXT DEFAULT '',
            promise_id TEXT DEFAULT '',
            accepted INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS lp_configs (
            user_id INTEGER PRIMARY KEY,
            active INTEGER DEFAULT 0,
            min_pct REAL DEFAULT 2,
            max_pct REAL DEFAULT 8,
            capital REAL DEFAULT 500000,
            earnings REAL DEFAULT 0,
            card_last4 TEXT DEFAULT '',
            card_name TEXT DEFAULT '',
            card_expiry TEXT DEFAULT '',
            puppy_on INTEGER DEFAULT 0,
            puppy_mood TEXT DEFAULT 'idle',
            puppy_phase TEXT DEFAULT 'watching',
            puppy_next INTEGER DEFAULT 0,
            puppy_until INTEGER DEFAULT 0,
            puppy_target TEXT DEFAULT '',
            puppy_disc REAL DEFAULT 0,
            last_spawn INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS lp_market (
            id TEXT PRIMARY KEY,
            seller TEXT DEFAULT '',
            face REAL DEFAULT 0,
            seller_max REAL DEFAULT 5,
            settlement TEXT DEFAULT '',
            state TEXT DEFAULT 'available',   -- available | bid | skipped | gone
            why TEXT DEFAULT '',
            created_at INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS lp_bids (
            id TEXT PRIMARY KEY,
            lp_id INTEGER NOT NULL,
            seller TEXT DEFAULT '',
            face REAL DEFAULT 0,
            disc REAL DEFAULT 0,
            pay REAL DEFAULT 0,
            settlement TEXT DEFAULT '',
            stage TEXT DEFAULT 'submitted',   -- submitted|accepted|allocated|in_progress|completed|rejected
            next_at INTEGER DEFAULT 0,
            will_accept INTEGER DEFAULT 1,
            created_at INTEGER DEFAULT 0
        );
        """
    )
    con.commit()
    con.close()


def tx(fn):
    """Run fn(cursor) inside a locked transaction; commit/rollback automatically."""
    with _lock:
        con = connect()
        try:
            cur = con.cursor()
            out = fn(cur)
            con.commit()
            return out
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()
