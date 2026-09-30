"""Puppy — server-side automated bidding engine.

Same state model as the client: market promises move available -> bid|skipped,
bids move submitted -> accepted -> allocated -> in_progress -> completed
(or rejected). Tick is driven by POST /lp/puppy/tick so the backend owns the
truth; the frontend polls it while Puppy is awake.
"""
import random
import time

from . import db

SELLERS = ['Adaeze O.', 'Chidi M.', 'Fatima K.', 'Tunde A.', 'Ngozi E.', 'Ifeanyi U.']
FACES = [25000, 40000, 75000, 120000, 200000]
DATES = ['Sept 30', 'Oct 3', 'Oct 7', 'Oct 12']
NEVER = 9_999_999_999_999


def _log(cur, text, now):
    cur.execute('INSERT INTO notifications (id, user_id, phone, text, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                ('log' + str(now) + str(random.randint(0, 9999)), None, '', text, 'puppy', now))


def get_lp(user_id: int) -> dict:
    def _q(cur):
        row = cur.execute('SELECT * FROM lp_configs WHERE user_id = ?', (user_id,)).fetchone()
        return dict(row) if row else None
    return db.tx(_q)


def ensure_lp(user_id: int) -> dict:
    cfg = get_lp(user_id)
    if cfg:
        return cfg

    def _q(cur):
        cur.execute('INSERT INTO lp_configs (user_id) VALUES (?)', (user_id,))
        return dict(cur.execute('SELECT * FROM lp_configs WHERE user_id = ?', (user_id,)).fetchone())
    return db.tx(_q)


def spawn_market(now_ms: int) -> dict:
    item = {
        'id': 'mk%d%d' % (now_ms, random.randint(0, 999)),
        'seller': random.choice(SELLERS),
        'face': random.choice(FACES),
        'seller_max': 1 + random.randint(0, 9),
        'settlement': random.choice(DATES),
        'state': 'available',
        'why': '',
        'created_at': now_ms,
    }

    def _q(cur):
        cur.execute('INSERT INTO lp_market (id, seller, face, seller_max, settlement, state, why, created_at) VALUES (?,?,?,?,?,?,?,?)',
                    (item['id'], item['seller'], item['face'], item['seller_max'], item['settlement'], 'available', '', now_ms))
        cur.execute('DELETE FROM lp_market WHERE id NOT IN (SELECT id FROM lp_market ORDER BY created_at DESC LIMIT 8)')
    db.tx(_q)
    return item


def tick(user_id: int) -> dict:
    """Advance one Puppy cycle. Returns the fresh dashboard snapshot."""
    now = int(time.time() * 1000)

    def _q(cur):
        cfg = cur.execute('SELECT * FROM lp_configs WHERE user_id = ?', (user_id,)).fetchone()
        if not cfg:
            cur.execute('INSERT INTO lp_configs (user_id) VALUES (?)', (user_id,))
            cfg = cur.execute('SELECT * FROM lp_configs WHERE user_id = ?', (user_id,)).fetchone()
        cfg = dict(cfg)
        changed_log = []

        def say(text):
            changed_log.append(text)
            cur.execute('INSERT INTO notifications (id, user_id, phone, text, kind, created_at) VALUES (?,?,?,?,?,?)',
                        ('log%d%d' % (now, random.randint(0, 99999)), user_id, '', text, 'puppy', now))

        # 1. advance bids by time
        bids = [dict(r) for r in cur.execute('SELECT * FROM lp_bids WHERE lp_id = ? ORDER BY created_at DESC', (user_id,))]
        for b in bids:
            if now < (b['next_at'] or 0):
                continue
            if b['stage'] == 'submitted':
                if b['will_accept']:
                    cur.execute("UPDATE lp_bids SET stage='accepted', next_at=? WHERE id=?", (now + 1200, b['id']))
                    cur.execute("UPDATE lp_configs SET puppy_mood='happy', puppy_until=? WHERE user_id=?", (now + 1800, user_id))
                    say('Bid accepted: %s from %s' % (b['face'], b['seller']))
                else:
                    cur.execute("UPDATE lp_bids SET stage='rejected', next_at=? WHERE id=?", (NEVER, b['id']))
                    cur.execute("UPDATE lp_configs SET puppy_mood='sad', puppy_until=? WHERE user_id=?", (now + 1800, user_id))
                    say('%s turned the bid down' % b['seller'])
            elif b['stage'] == 'accepted':
                cur.execute("UPDATE lp_bids SET stage='allocated', next_at=? WHERE id=?", (now + 1500, b['id']))
                cur.execute('UPDATE lp_configs SET capital = capital - ? WHERE user_id = ?', (b['pay'], user_id))
                say('Liquidity allocated: %s' % b['pay'])
            elif b['stage'] == 'allocated':
                cur.execute("UPDATE lp_bids SET stage='in_progress', next_at=? WHERE id=?", (now + 3000, b['id']))
            elif b['stage'] == 'in_progress':
                cur.execute("UPDATE lp_bids SET stage='completed', next_at=? WHERE id=?", (NEVER, b['id']))
                cur.execute('UPDATE lp_configs SET capital = capital + ?, earnings = earnings + ?, puppy_mood=?, puppy_until=? WHERE user_id = ?',
                            (b['face'], b['face'] - b['pay'], 'happy', now + 2200, user_id))
                say('Completed: earned %s' % (b['face'] - b['pay']))

        cfg = dict(cur.execute('SELECT * FROM lp_configs WHERE user_id = ?', (user_id,)).fetchone())

        # 2. Puppy behaviour
        if cfg['puppy_on']:
            if cfg['puppy_mood'] in ('happy', 'sad') and now >= (cfg['puppy_until'] or 0):
                cur.execute("UPDATE lp_configs SET puppy_mood='watching' WHERE user_id=?", (user_id,))
            open_n = cur.execute("SELECT COUNT(*) c FROM lp_market WHERE state='available'").fetchone()['c']
            if open_n < 2 and now - (cfg['last_spawn'] or 0) > 5000:
                m = {'id': 'mk%d%d' % (now, random.randint(0, 999)), 'seller': random.choice(SELLERS),
                     'face': random.choice(FACES), 'seller_max': 1 + random.randint(0, 9), 'settlement': random.choice(DATES)}
                cur.execute('INSERT INTO lp_market (id, seller, face, seller_max, settlement, state, created_at) VALUES (?,?,?,?,?,?,?)',
                            (m['id'], m['seller'], m['face'], m['seller_max'], m['settlement'], 'available', now))
                cur.execute('DELETE FROM lp_market WHERE id NOT IN (SELECT id FROM lp_market ORDER BY created_at DESC LIMIT 8)')
                cur.execute('UPDATE lp_configs SET last_spawn=? WHERE user_id=?', (now, user_id))
                say('New promise from %s: %s' % (m['seller'], m['face']))
            if now >= (cfg['puppy_next'] or 0):
                busy = cfg['puppy_mood'] in ('happy', 'sad')
                if cfg['puppy_phase'] == 'watching':
                    t = cur.execute("SELECT * FROM lp_market WHERE state='available' ORDER BY created_at LIMIT 1").fetchone()
                    if t:
                        cur.execute("UPDATE lp_configs SET puppy_phase='evaluating', puppy_target=?, puppy_next=? WHERE user_id=?", (t['id'], now + 1500, user_id))
                        if not busy:
                            cur.execute("UPDATE lp_configs SET puppy_mood='evaluating' WHERE user_id=?", (user_id,))
                elif cfg['puppy_phase'] == 'evaluating':
                    t = cur.execute('SELECT * FROM lp_market WHERE id=?', (cfg['puppy_target'],)).fetchone()
                    cur.execute("UPDATE lp_configs SET puppy_phase='watching', puppy_next=? WHERE user_id=?", (now + 900, user_id))
                    if t and t['state'] == 'available':
                        disc = min(cfg['max_pct'], t['seller_max'])
                        pay = round(t['face'] * (1 - disc / 100))
                        if disc < cfg['min_pct']:
                            cur.execute("UPDATE lp_market SET state='skipped', why=? WHERE id=?",
                                        ('Seller stops at %s%%, below your %s%% minimum' % (t['seller_max'], cfg['min_pct']), t['id']))
                            if not busy:
                                cur.execute("UPDATE lp_configs SET puppy_mood='watching' WHERE user_id=?", (user_id,))
                            say('Skipped %s: outside your range' % t['face'])
                        elif pay > cfg['capital']:
                            cur.execute("UPDATE lp_market SET state='skipped', why='Not enough liquidity' WHERE id=?", (t['id'],))
                            cur.execute("UPDATE lp_configs SET puppy_mood='attention' WHERE user_id=?", (user_id,))
                            say('Need more liquidity for %s' % t['face'])
                        else:
                            cur.execute('UPDATE lp_configs SET puppy_phase=?, puppy_disc=?, puppy_next=? WHERE user_id=?',
                                        ('bidding', disc, now + 1100, user_id))
                            if not busy:
                                cur.execute("UPDATE lp_configs SET puppy_mood='bidding' WHERE user_id=?", (user_id,))
                elif cfg['puppy_phase'] == 'bidding':
                    t = cur.execute('SELECT * FROM lp_market WHERE id=?', (cfg['puppy_target'],)).fetchone()
                    if t and t['state'] == 'available':
                        pay = round(t['face'] * (1 - cfg['puppy_disc'] / 100))
                        bid_id = 'bid%d' % now
                        cur.execute('INSERT INTO lp_bids (id, lp_id, seller, face, disc, pay, settlement, stage, next_at, will_accept, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                                    (bid_id, user_id, t['seller'], t['face'], cfg['puppy_disc'], pay, t['settlement'], 'submitted', now + 2600, 1 if random.random() > 0.2 else 0, now))
                        cur.execute("UPDATE lp_market SET state='bid' WHERE id=?", (t['id'],))
                        say('Bid %s%% on %s from %s' % (cfg['puppy_disc'], t['face'], t['seller']))
                    cur.execute("UPDATE lp_configs SET puppy_phase='watching', puppy_next=? WHERE user_id=?", (now + 1600, user_id))
                    if not busy:
                        cur.execute("UPDATE lp_configs SET puppy_mood='waiting' WHERE user_id=?", (user_id,))
        return changed_log
    db.tx(_q)
    return snapshot(user_id)


def snapshot(user_id: int) -> dict:
    def _q(cur):
        cfg = cur.execute('SELECT * FROM lp_configs WHERE user_id = ?', (user_id,)).fetchone()
        market = [dict(r) for r in cur.execute('SELECT * FROM lp_market ORDER BY created_at DESC LIMIT 8')]
        bids = [dict(r) for r in cur.execute('SELECT * FROM lp_bids WHERE lp_id = ? ORDER BY created_at DESC LIMIT 12', (user_id,))]
        log = [dict(r) for r in cur.execute("SELECT text t, created_at at FROM notifications WHERE user_id = ? AND kind='puppy' ORDER BY created_at DESC LIMIT 8", (user_id,))]
        return {'config': dict(cfg) if cfg else None, 'market': market, 'bids': bids, 'log': log}
    return db.tx(_q)
