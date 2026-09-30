"""Idempotent demo seed: staff, demo users, provider LPs, sample chain, queue item."""
import json
import time

from . import db
from .security import admin_passcode, hash_pin

NOW = int(time.time() * 1000)


def _user(cur, role, phone, email, name, pin, relay_id=''):
    digest, salt = hash_pin(pin)
    cur.execute('INSERT OR IGNORE INTO users (role, phone, email, name, pin_hash, pin_salt, relay_id, created_at) VALUES (?,?,?,?,?,?,?,?)',
                (role, phone, email, name, digest, salt, relay_id, NOW))
    return cur.execute('SELECT id FROM users WHERE phone = ? AND role = ?', (phone, role)).fetchone()['id']


def seed():
    db.init_db()

    def _q(cur):
        # staff
        digest, salt = hash_pin(admin_passcode())
        cur.execute("INSERT OR IGNORE INTO users (role, phone, email, name, pin_hash, pin_salt, relay_id, created_at) VALUES ('admin','', 'staff@relay.app','Staff',?,?, 'STAFF',?)",
                    (digest, salt, NOW))
        # demo personal user
        uid = _user(cur, 'personal', '08031234567', '', 'Bello', '1234', 'B-0421')
        cur.execute('INSERT OR IGNORE INTO lp_configs (user_id) VALUES (?)', (uid,))
        # demo payer
        pid = _user(cur, 'payer', '08055550000', 'pay@aethercode.com', 'Aethercode Ltd', '1234', 'P-0001')
        cur.execute('INSERT OR IGNORE INTO businesses (user_id, name, rc, type, verified) VALUES (?,?,?,?,?)',
                    (pid, 'Aethercode Ltd', 'RC1842204', 'employer', 0))
        cur.execute('INSERT OR IGNORE INTO workers (id, payer_id, name, phone, email, salary) VALUES (1,?,?,?, ?, ?)',
                    (pid, 'Adaeze O.', '08031112222', 'adaeze@example.com', 250000))
        cur.execute('INSERT OR IGNORE INTO workers (id, payer_id, name, phone, email, salary) VALUES (2,?,?,?, ?, ?)',
                    (pid, 'Chidi M.', '08033334444', 'chidi@example.com', 180000))
        # provider LPs (real accounts the auction engine bids with)
        for i, (name, phone, lo, hi, cap) in enumerate([
            ('Provider A', '08090000001', 2, 6, 2000000),
            ('Provider B', '08090000002', 1, 4, 2000000),
            ('Provider C', '08090000003', 3, 9, 2000000),
            ('Provider D', '08090000004', 4, 10, 2000000),
        ]):
            lid = _user(cur, 'personal', phone, '', name, '0000', 'LP-000%d' % (i + 1))
            cur.execute('INSERT OR IGNORE INTO lp_configs (user_id, active, min_pct, max_pct, capital) VALUES (?,?,?,?,?)',
                        (lid, 1, lo, hi, cap))
        # sample chain promise
        chain = json.dumps([])
        cur.execute("INSERT OR IGNORE INTO promises (id, owner_id, issuer_id, issuer_name, issuer_type, to_name, phone, amount, remaining, kind, settlement, status, health, accepted, chain, created_at) VALUES ('p-8472',?,?,?,?,?, 'You','08031234567',5000,5000,'in-transit','Network is down — settling when it returns','verified','healthy',1,?,?)",
                    (None, None, 'A', 'personal', chain, NOW))
        cur.execute("INSERT OR IGNORE INTO promises (id, owner_id, issuer_id, issuer_name, issuer_type, to_name, phone, amount, remaining, kind, settlement, status, health, accepted, chain, created_at) VALUES ('p-salary',?,?,?,?,?, 'You','08031234567',25000,25000,'trusted','Settles Sept 30','verified','healthy',1,?,?)",
                    (uid, pid, 'Aethercode Ltd', 'employer', '[]', NOW))
        # pending verification request
        cur.execute("INSERT OR IGNORE INTO requests (id, issuer_id, kind, issuer_type, issuer_name, settlement, note, to_name, phone, email, amount, status, created_at) VALUES ('rq-seed-1',?, 'trusted','employer','Aethercode Ltd','Sept 30','Sept salary','Adaeze O.','08031112222','adaeze@example.com',250000,'pending',?)",
                    (pid, NOW))
        cur.execute("INSERT OR IGNORE INTO notifications (id, user_id, phone, text, kind, created_at) VALUES ('n-seed-1',?,'','Promise #8472 verified — NGN5,000 spendable now','promise',?)", (uid, NOW))
        return {'personal': uid, 'payer': pid}
    return db.tx(_q)


if __name__ == '__main__':
    print(seed())
