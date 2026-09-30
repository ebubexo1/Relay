"""Relay backend — FastAPI + SQLite. Single source of truth for auth, promises,
verification queue, auctions, LP/Puppy engine, workers, escrows, documents."""
import json
import os
import random
import time

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import db, delivery, puppy
from .security import (admin_passcode, check_pin, create_session, hash_pin,
                       public_user, require_role, require_user)
from .seed import seed

UPLOAD_DIR = db.UPLOAD_DIR
MAX_UPLOAD = 10 * 1024 * 1024

app = FastAPI(title='Relay API', version='0.1.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


def now_ms() -> int:
    return int(time.time() * 1000)


def row(d):
    return dict(d) if d else None


# ---------- schemas ----------
class RegisterPersonal(BaseModel):
    phone: str
    pin: str


class RegisterPayer(BaseModel):
    business_name: str
    business_email: str = ''
    phone: str = ''
    rc: str = ''
    business_type: str = 'employer'
    pin: str


class Login(BaseModel):
    identifier: str  # phone, email, or 'admin'
    pin: str


class PromiseRequest(BaseModel):
    kind: str = 'trusted'
    to_name: str
    phone: str = ''
    email: str = ''
    amount: float
    ref: str = ''
    escrow_ref: str = ''
    settlement: str = 'Pending'
    note: str = ''


class BatchRequests(BaseModel):
    issuer_type: str = 'employer'
    issuer_name: str = ''
    kind: str = 'trusted'
    escrow_ref: str = ''
    settlement: str = 'Pending'
    note: str = ''
    items: list = []


class ForwardIn(BaseModel):
    to: str
    amount: float


class AuctionIn(BaseModel):
    promise_id: str


class AcceptBidIn(BaseModel):
    bid_id: int


class LPConfigIn(BaseModel):
    min_pct: float
    max_pct: float


class LPCardIn(BaseModel):
    last4: str
    name: str = ''
    expiry: str = ''


class WorkerIn(BaseModel):
    name: str
    phone: str = ''
    email: str = ''
    salary: float = 0


class PayWorkersIn(BaseModel):
    ids: list = []
    settlement: str = 'Month end'


class EscrowIn(BaseModel):
    purpose: str
    amount: float
    beneficiary: str = ''
    partner: str = ''
    release_cond: str = ''


class BusinessIn(BaseModel):
    name: str
    rc: str = ''
    type: str = 'employer'


class ExternalBidIn(BaseModel):
    promise_id: str
    amount: float
    bank: str
    acct: str


# ---------- boot ----------
@app.on_event('startup')
def _startup():
    db.init_db()
    if os.environ.get('RELAY_SEED', '1') == '1':
        try:
            seed()
        except Exception as e:  # noqa: BLE001 - seed must never block boot
            print('seed skipped:', e)


@app.get('/health')
def health():
    return {'ok': True, 'service': 'relay-api'}


# ---------- auth ----------
@app.post('/auth/register')
def register_personal(body: RegisterPersonal):
    phone = ''.join(ch for ch in body.phone if ch.isdigit() or ch == '+')
    if len(phone.replace('+', '')) < 7 or not body.pin or len(body.pin) < 4:
        raise HTTPException(400, 'Valid phone + PIN (4+ chars) required')

    def _q(cur):
        exists = cur.execute("SELECT id FROM users WHERE phone = ? AND role = 'personal'", (body.phone,)).fetchone()
        if exists:
            raise HTTPException(409, 'Account already exists — sign in instead')
        digest, salt = hash_pin(body.pin)
        relay_id = 'B-%04d' % random.randint(1000, 9999)
        cur.execute('INSERT INTO users (role, phone, name, pin_hash, pin_salt, relay_id, created_at) VALUES (?,?,?,?,?,?,?)',
                    ('personal', body.phone, 'User', digest, salt, relay_id, now_ms()))
        uid = cur.lastrowid
        cur.execute('INSERT INTO lp_configs (user_id) VALUES (?)', (uid,))
        return uid
    uid = db.tx(_q)
    token = create_session(uid)
    return {'token': token, 'user': public_user(db.tx(lambda c: row(c.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone())))}


@app.post('/auth/register-payer')
def register_payer(body: RegisterPayer):
    if not body.business_name or not body.pin or len(body.pin) < 4:
        raise HTTPException(400, 'Business name + PIN required')

    def _q(cur):
        digest, salt = hash_pin(body.pin)
        cur.execute('INSERT INTO users (role, phone, email, name, pin_hash, pin_salt, relay_id, created_at) VALUES (?,?,?,?,?,?,?,?)',
                    ('payer', body.phone, body.business_email, body.business_name, digest, salt, 'P-%04d' % random.randint(1000, 9999), now_ms()))
        uid = cur.lastrowid
        cur.execute('INSERT INTO businesses (user_id, name, rc, type, verified) VALUES (?,?,?,?,0)',
                    (uid, body.business_name, body.rc, body.business_type))
        return uid
    uid = db.tx(_q)
    token = create_session(uid)
    return {'token': token, 'user': public_user(db.tx(lambda c: row(c.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone())))}


@app.post('/auth/login')
def login(body: Login):
    if body.identifier.strip().lower() == 'admin':
        if body.pin != admin_passcode():
            raise HTTPException(401, 'Wrong admin passcode')

        def _q(cur):
            adm = cur.execute("SELECT * FROM users WHERE role='admin'").fetchone()
            if not adm:
                digest, salt = hash_pin(admin_passcode())
                cur.execute("INSERT INTO users (role, name, pin_hash, pin_salt, created_at) VALUES ('admin','Staff',?,?,?)",
                            (digest, salt, now_ms()))
                adm = cur.execute("SELECT * FROM users WHERE role='admin'").fetchone()
            return dict(adm)
        user = db.tx(_q)
        return {'token': create_session(user['id']), 'user': public_user(user)}

    def _q(cur):
        u = cur.execute('SELECT * FROM users WHERE (phone = ? OR email = ?) AND role != ?', (body.identifier, body.identifier, 'admin')).fetchone()
        if not u or not check_pin(body.pin, u['pin_hash'], u['pin_salt']):
            raise HTTPException(401, 'Wrong credentials')
        return dict(u)
    user = db.tx(_q)
    return {'token': create_session(user['id']), 'user': public_user(user)}


@app.get('/me')
def me(user: dict = Depends(require_user)):
    uid = user['id']
    out = {'user': public_user(user)}
    if user['role'] == 'payer':
        out['business'] = db.tx(lambda c: row(c.execute('SELECT * FROM businesses WHERE user_id=?', (uid,)).fetchone()))
    if user['role'] == 'personal':
        out['lp'] = puppy.get_lp(uid)
    return out


# ---------- state snapshot ----------
@app.get('/state')
def snapshot(user: dict = Depends(require_user)):
    uid = user['id']
    phone = user.get('phone') or ''

    def _q(cur):
        promises = [dict(r) for r in cur.execute(
            'SELECT * FROM promises WHERE owner_id = ? OR phone = ? ORDER BY created_at DESC', (uid, phone))]
        for p in promises:
            p['chain'] = {'edges': json.loads(p.pop('chain') or '[]')}
            p['pendingAccept'] = bool(p.pop('accepted') == 0)
            p['label'] = 'To ' + p['to_name'] if (p['issuer_id'] in (uid, None) and p['to_name'] and p['to_name'] != 'You') else ('From ' + p['issuer_name'] if p['issuer_name'] else p['to_name'])
            p['remaining'] = p['remaining']
        notifs = [dict(r) for r in cur.execute(
            'SELECT * FROM notifications WHERE user_id = ? OR (phone != "" AND phone = ?) ORDER BY created_at DESC LIMIT 30', (uid, phone))]
        txs = [dict(r) for r in cur.execute('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 30', (uid,))]
        out = {'promises': promises, 'notifications': notifs, 'transactions': txs}
        if user['role'] == 'payer':
            out['business'] = row(cur.execute('SELECT * FROM businesses WHERE user_id=?', (uid,)).fetchone())
            out['workers'] = [dict(r) for r in cur.execute('SELECT * FROM workers WHERE payer_id=?', (uid,))]
            out['escrows'] = [dict(r) for r in cur.execute('SELECT * FROM escrows WHERE payer_id=? ORDER BY created_at DESC', (uid,))]
            out['documents'] = [dict(r) for r in cur.execute('SELECT id, payer_id, name, mime, size, created_at FROM documents WHERE payer_id=? ORDER BY created_at DESC', (uid,))]
            out['requests'] = [dict(r) for r in cur.execute('SELECT * FROM requests WHERE issuer_id=? ORDER BY created_at DESC LIMIT 50', (uid,))]
            out['issued'] = [dict(r) for r in cur.execute('SELECT * FROM promises WHERE issuer_id=? ORDER BY created_at DESC LIMIT 50', (uid,))]
        if user['role'] == 'personal':
            out['lp'] = puppy.snapshot(uid)
            out['holdings'] = [dict(r) for r in cur.execute('SELECT * FROM holdings WHERE lp_id=? ORDER BY created_at DESC', (uid,))]
        if user['role'] == 'admin':
            out['requests'] = [dict(r) for r in cur.execute('SELECT * FROM requests ORDER BY created_at DESC LIMIT 100')]
            out['businesses'] = [dict(r) for r in cur.execute('SELECT b.*, u.phone FROM businesses b JOIN users u ON u.id=b.user_id WHERE b.verified=0')]
        return out
    return db.tx(_q)


# ---------- verification queue ----------
@app.post('/requests', dependencies=[Depends(require_role('payer', 'admin'))])
def create_requests(body: BatchRequests, user: dict = Depends(require_user)):
    items = body.items or []
    if not items:
        raise HTTPException(400, 'No items')
    t = now_ms()

    def _q(cur):
        ids = []
        for i, r in enumerate(items):
            rid = 'rq%d-%d' % (t, i)
            cur.execute('INSERT INTO requests (id, issuer_id, kind, issuer_type, issuer_name, escrow_ref, settlement, note, to_name, phone, email, amount, ref, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        (rid, user['id'], r.get('kind', body.kind), body.issuer_type, body.issuer_name, body.escrow_ref, body.settlement, body.note,
                         r.get('to', ''), r.get('phone', ''), r.get('email', ''), float(r.get('amount', 0) or 0), r.get('ref', ''), 'pending', t))
            ids.append(rid)
        cur.execute('INSERT INTO notifications (id, user_id, phone, text, kind, created_at) VALUES (?,?,?,?,?,?)',
                    ('n%d' % t, user['id'], '', 'Sent %d request(s) to the verification board' % len(ids), '', t))
        return ids
    return {'ids': db.tx(_q)}


@app.get('/requests')
def list_requests(user: dict = Depends(require_user)):
    def _q(cur):
        if user['role'] == 'admin':
            rows = cur.execute('SELECT * FROM requests ORDER BY created_at DESC LIMIT 100').fetchall()
        else:
            rows = cur.execute('SELECT * FROM requests WHERE issuer_id=? ORDER BY created_at DESC LIMIT 100', (user['id'],)).fetchall()
        return [dict(r) for r in rows]
    return db.tx(_q)


@app.post('/requests/{rid}/approve', dependencies=[Depends(require_role('admin'))])
def approve_request(rid: str):
    def _q(cur):
        r = cur.execute('SELECT * FROM requests WHERE id=?', (rid,)).fetchone()
        if not r or r['status'] != 'pending':
            raise HTTPException(400, 'Request not actionable')
        r = dict(r)
        t = now_ms()
        pid = 'p-%d' % t
        ref = r['ref'] or ('RL-' + str(t)[-6:])
        owner = cur.execute('SELECT id FROM users WHERE phone = ? AND role = ?', (r['phone'], 'personal')).fetchone() if r['phone'] else None
        owner_id = owner['id'] if owner else None
        cur.execute('INSERT INTO promises (id, owner_id, issuer_id, issuer_name, issuer_type, to_name, phone, email, amount, remaining, kind, settlement, escrow_ref, ref, status, health, accepted, chain, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    (pid, owner_id, r['issuer_id'], r['issuer_name'], r['issuer_type'], r['to_name'], r['phone'], r['email'], r['amount'], r['amount'],
                     r['kind'], r['settlement'], r['escrow_ref'], ref, 'verified', 'attention' if r['kind'] == 'escrow' else 'healthy', 0, '[]', t))
        cur.execute("UPDATE requests SET status='approved' WHERE id=?", (rid,))
        cur.execute('INSERT INTO notifications (id, user_id, phone, text, kind, promise_id, created_at) VALUES (?,?,?,?,?,?,?)',
                    ('n%d' % t, owner_id, r['phone'], '%s promise issued — %s to %s' % (r['kind'], r['amount'], r['to_name']), 'promise', pid, t))
        return {'promise_id': pid, 'to': {'phone': r['phone'], 'email': r['email'], 'name': r['to_name']},
                'amount': r['amount'], 'issuer': r['issuer_name'], 'ref': ref}
    out = db.tx(_q)
    amt_text = 'NGN%s' % ('{:,.0f}'.format(out['amount']))
    results = delivery.notify_issued(out['to']['phone'], out['to']['email'], out['to']['name'], amt_text, out['issuer'], out['ref'])
    live = any((not x.get('demo')) and x.get('ok') for x in results)
    return {'promise_id': out['promise_id'], 'delivery': results, 'live': live}


@app.post('/requests/{rid}/reject', dependencies=[Depends(require_role('admin'))])
def reject_request(rid: str):
    def _q(cur):
        cur.execute("UPDATE requests SET status='rejected' WHERE id=? AND status='pending'", (rid,))
        return cur.rowcount
    if not db.tx(_q):
        raise HTTPException(400, 'Request not actionable')
    return {'ok': True}


# ---------- promises (consumer) ----------
@app.get('/promises')
def my_promises(user: dict = Depends(require_user)):
    phone = user.get('phone') or ''

    def _q(cur):
        rows = cur.execute('SELECT * FROM promises WHERE owner_id = ? OR phone = ? ORDER BY created_at DESC', (user['id'], phone)).fetchall()
        out = []
        for r in rows:
            p = dict(r)
            p['chain'] = {'edges': json.loads(p.pop('chain') or '[]')}
            p['pendingAccept'] = p.pop('accepted') == 0
            out.append(p)
        return out
    return db.tx(_q)


@app.post('/promises/{pid}/accept')
def accept_promise(pid: str, user: dict = Depends(require_user)):
    db.tx(lambda c: c.execute('UPDATE promises SET accepted=1 WHERE id=?', (pid,)))
    return {'ok': True}


@app.post('/promises/{pid}/decline')
def decline_promise(pid: str, user: dict = Depends(require_user)):
    db.tx(lambda c: c.execute("UPDATE promises SET status='declined', remaining=0 WHERE id=?", (pid,)))
    return {'ok': True}


@app.post('/promises/{pid}/forward')
def forward(pid: str, body: ForwardIn, user: dict = Depends(require_user)):
    if not body.amount or body.amount <= 0 or not body.to:
        raise HTTPException(400, 'Recipient + positive amount required')

    def _q(cur):
        p = cur.execute('SELECT * FROM promises WHERE id=?', (pid,)).fetchone()
        if not p or p['remaining'] < body.amount:
            raise HTTPException(400, 'Insufficient spendable balance')
        edges = json.loads(p['chain'] or '[]')
        frm = edges[-1]['to'] if edges else 'B (you)'
        edges.append({'from': frm, 'to': body.to, 'amount': body.amount})
        seq = cur.execute('SELECT COUNT(*) c FROM transfers WHERE promise_id=?', (pid,)).fetchone()['c']
        cur.execute('INSERT INTO transfers (promise_id, frm, to_name, amount, seq) VALUES (?,?,?,?,?)',
                    (pid, frm, body.to, body.amount, seq))
        cur.execute('UPDATE promises SET remaining = remaining - ?, chain = ? WHERE id=?', (body.amount, json.dumps(edges), pid))
        return {'edges': edges}
    return db.tx(_q)


@app.post('/promises/{pid}/settle')
def settle(pid: str, user: dict = Depends(require_user)):
    """FIFO settlement: inbound value pays earliest forwards first, remainder to holder."""
    def _q(cur):
        p = cur.execute('SELECT * FROM promises WHERE id=?', (pid,)).fetchone()
        if not p:
            raise HTTPException(404, 'Promise not found')
        p = dict(p)
        edges = json.loads(p['chain'] or '[]')
        t = now_ms()
        legs = [{'to': e['to'], 'amount': e['amount']} for e in edges]  # FIFO = stored order
        forwarded = sum(e['amount'] for e in edges)
        mine = round(p['amount'] - forwarded, 2)
        if mine > 0:
            legs.append({'to': p['to_name'] or 'You', 'amount': mine})
        cur.execute('UPDATE promises SET remaining=0, status=? WHERE id=?', ('settled', pid))
        for leg in legs:
            cur.execute('INSERT INTO transactions (user_id, amount, description, kind, created_at) VALUES (?,?,?,?,?)',
                        (user['id'], leg['amount'], '%s received (settled %s)' % (leg['to'], pid), 'settled', t))
        return {'legs': legs, 'total': p['amount']}
    return db.tx(_q)


# ---------- auctions (speed + efficient allocation) ----------
@app.post('/auctions')
def create_auction(body: AuctionIn, user: dict = Depends(require_user)):
    def _q(cur):
        p = cur.execute('SELECT * FROM promises WHERE id=?', (body.promise_id,)).fetchone()
        if not p or p['remaining'] <= 0:
            raise HTTPException(400, 'Claim not available')
        # Every registered active LP bids inside its own configured range.
        lps = cur.execute("SELECT u.id, u.name, l.min_pct, l.max_pct FROM lp_configs l JOIN users u ON u.id=l.user_id WHERE l.active=1").fetchall()
        if not lps:
            raise HTTPException(400, 'No active liquidity providers yet')
        t = now_ms()
        aid = 'auc%d' % t
        cur.execute('INSERT INTO auctions (id, promise_id, seller_id, status, created_at) VALUES (?,?,?,?,?)',
                    (aid, body.promise_id, user['id'], 'open', t))
        bids = []
        for lp in lps:
            disc = round(random.uniform(lp['min_pct'], lp['max_pct']), 1)
            amount = round(p['remaining'] * (1 - disc / 100))
            ms = random.randint(250, 950)
            cur.execute('INSERT INTO bids (auction_id, bidder_id, bidder_name, amount, discount, response_ms, status, created_at) VALUES (?,?,?,?,?,?,?,?)',
                        (aid, lp['id'], lp['name'] or 'Provider', amount, disc, ms, 'submitted', t))
            bids.append({'id': cur.lastrowid, 'bidder_name': lp['name'] or 'Provider', 'amount': amount, 'discount': disc, 'response_ms': ms})
        # speed cutoff: only bids inside the window compete; cheapest-to-seller... best payout wins
        cutoff = int(os.environ.get('RELAY_AUCTION_CUTOFF_MS', '900'))
        timely = [b for b in bids if b['response_ms'] <= cutoff] or bids
        timely.sort(key=lambda b: -b['amount'])
        return {'auction_id': aid, 'face': p['remaining'], 'cutoff_ms': cutoff, 'bids': timely}
    return db.tx(_q)


@app.post('/auctions/{aid}/accept')
def accept_bid(aid: str, body: AcceptBidIn, user: dict = Depends(require_user)):
    def _q(cur):
        a = cur.execute("SELECT * FROM auctions WHERE id=? AND status='open'", (aid,)).fetchone()
        if not a:
            raise HTTPException(400, 'Auction not open')
        b = cur.execute('SELECT * FROM bids WHERE id=? AND auction_id=?', (body.bid_id, aid)).fetchone()
        if not b:
            raise HTTPException(400, 'Bid not found')
        p = cur.execute('SELECT * FROM promises WHERE id=?', (a['promise_id'],)).fetchone()
        cur.execute("UPDATE auctions SET status='closed', winner_bid_id=? WHERE id=?", (body.bid_id, aid))
        cur.execute("UPDATE bids SET status='rejected' WHERE auction_id=? AND id != ?", (aid, body.bid_id))
        cur.execute("UPDATE bids SET status='accepted' WHERE id=?", (body.bid_id,))
        cur.execute('UPDATE promises SET remaining=0, status=? WHERE id=?', ('settled', a['promise_id']))
        t = now_ms()
        cur.execute('INSERT INTO transactions (user_id, amount, description, kind, created_at) VALUES (?,?,?,?,?)',
                    (user['id'], b['amount'], 'Sold %s to %s' % (a['promise_id'], b['bidder_name']), 'sale', t))
        if b['bidder_id']:
            cur.execute('INSERT INTO holdings (lp_id, claim_label, face, paid, settlement, created_at) VALUES (?,?,?,?,?,?)',
                        (b['bidder_id'], a['promise_id'], p['remaining'], b['amount'], p['settlement'], t))
        return {'received': b['amount'], 'discount': b['discount']}
    return db.tx(_q)


@app.post('/lp/buy')
def lp_buy_direct(body: AuctionIn, user: dict = Depends(require_user)):
    """Instant LP purchase at the buyer's configured mid-range (PuppyDesk manual buy)."""
    cfg = puppy.ensure_lp(user['id'])
    disc = round((cfg['min_pct'] + cfg['max_pct']) / 2, 1)

    def _q(cur):
        p = cur.execute('SELECT * FROM promises WHERE id=?', (body.promise_id,)).fetchone()
        if not p or p['remaining'] <= 0:
            raise HTTPException(400, 'Claim not available')
        price = round(p['remaining'] * (1 - disc / 100))
        cur.execute('UPDATE promises SET remaining=0, status=? WHERE id=?', ('settled', body.promise_id))
        cur.execute('INSERT INTO holdings (lp_id, claim_label, face, paid, settlement, created_at) VALUES (?,?,?,?,?,?)',
                    (user['id'], body.promise_id, p['remaining'], price, p['settlement'], now_ms()))
        return {'paid': price, 'face': p['remaining'], 'discount': disc}
    return db.tx(_q)


# ---------- LP ----------
@app.post('/lp/activate')
def lp_activate(user: dict = Depends(require_role('personal'))):
    puppy.ensure_lp(user['id'])
    db.tx(lambda c: c.execute('UPDATE lp_configs SET active=1 WHERE user_id=?', (user['id'],)))
    return {'active': True}


@app.put('/lp/config')
def lp_config(body: LPConfigIn, user: dict = Depends(require_role('personal'))):
    if not (0 <= body.min_pct <= body.max_pct <= 50):
        raise HTTPException(400, 'Need 0 ≤ min ≤ max ≤ 50')
    puppy.ensure_lp(user['id'])
    db.tx(lambda c: c.execute('UPDATE lp_configs SET min_pct=?, max_pct=? WHERE user_id=?', (body.min_pct, body.max_pct, user['id'])))
    return {'min_pct': body.min_pct, 'max_pct': body.max_pct}


@app.post('/lp/card')
def lp_card(body: LPCardIn, user: dict = Depends(require_role('personal'))):
    if len(body.last4) != 4 or not body.last4.isdigit():
        raise HTTPException(400, 'last4 must be 4 digits — never send the full PAN')
    puppy.ensure_lp(user['id'])
    db.tx(lambda c: c.execute('UPDATE lp_configs SET card_last4=?, card_name=?, card_expiry=? WHERE user_id=?',
                              (body.last4, body.name, body.expiry, user['id'])))
    return {'ok': True}


@app.delete('/lp/card')
def lp_card_remove(user: dict = Depends(require_role('personal'))):
    db.tx(lambda c: c.execute("UPDATE lp_configs SET card_last4='', card_name='', card_expiry='', puppy_on=0, puppy_mood='idle' WHERE user_id=?", (user['id'],)))
    return {'ok': True}


@app.post('/lp/puppy/on')
def puppy_on(user: dict = Depends(require_role('personal'))):
    cfg = puppy.ensure_lp(user['id'])
    if not cfg['card_last4']:
        raise HTTPException(400, 'Save a card first — Puppy needs a funding source')
    db.tx(lambda c: c.execute("UPDATE lp_configs SET puppy_on=1, puppy_mood='watching', puppy_phase='watching', puppy_next=? WHERE user_id=?", (now_ms(), user['id'])))
    return {'on': True}


@app.post('/lp/puppy/off')
def puppy_off(user: dict = Depends(require_role('personal'))):
    db.tx(lambda c: c.execute("UPDATE lp_configs SET puppy_on=0, puppy_mood='idle' WHERE user_id=?", (user['id'],)))
    return {'on': False}


@app.post('/lp/puppy/tick')
def puppy_tick(user: dict = Depends(require_role('personal'))):
    return puppy.tick(user['id'])


@app.get('/lp/dashboard')
def lp_dashboard(user: dict = Depends(require_role('personal'))):
    snap = puppy.snapshot(user['id'])

    def _q(cur):
        holds = [dict(r) for r in cur.execute('SELECT * FROM holdings WHERE lp_id=? ORDER BY created_at DESC', (user['id'],))]
        return holds
    return {**snap, 'holdings': db.tx(_q)}


@app.post('/lp/market/inject')
def market_inject(user: dict = Depends(require_role('personal'))):
    return puppy.spawn_market(now_ms())


# ---------- payer: business / workers / escrows / documents ----------
@app.put('/business')
def save_business(body: BusinessIn, user: dict = Depends(require_role('payer'))):
    if not body.name:
        raise HTTPException(400, 'Business name required')
    db.tx(lambda c: c.execute('INSERT INTO businesses (user_id, name, rc, type, verified) VALUES (?,?,?,?,0) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name, rc=excluded.rc, type=excluded.type',
                              (user['id'], body.name, body.rc, body.type)))
    return {'ok': True}


@app.post('/payer/card')
def payer_card(body: LPCardIn, user: dict = Depends(require_role('payer'))):
    if len(body.last4) != 4 or not body.last4.isdigit():
        raise HTTPException(400, 'last4 must be 4 digits')
    return {'ok': True, 'uses': ['escrow', 'salary']}


@app.get('/workers')
def list_workers(user: dict = Depends(require_role('payer'))):
    return db.tx(lambda c: [dict(r) for r in c.execute('SELECT * FROM workers WHERE payer_id=?', (user['id'],))])


@app.post('/workers')
def add_worker(body: WorkerIn, user: dict = Depends(require_role('payer'))):
    if not body.name or body.salary <= 0:
        raise HTTPException(400, 'Name + salary required')

    def _q(cur):
        cur.execute('INSERT INTO workers (payer_id, name, phone, email, salary) VALUES (?,?,?,?,?)',
                    (user['id'], body.name, body.phone, body.email, body.salary))
        return cur.lastrowid
    return {'id': db.tx(_q)}


@app.delete('/workers/{wid}')
def remove_worker(wid: int, user: dict = Depends(require_role('payer'))):
    db.tx(lambda c: c.execute('DELETE FROM workers WHERE id=? AND payer_id=?', (wid, user['id'])))
    return {'ok': True}


@app.post('/workers/pay')
def pay_workers(body: PayWorkersIn, user: dict = Depends(require_role('payer'))):
    if not body.ids:
        raise HTTPException(400, 'Select workers')

    def _q(cur):
        biz = cur.execute('SELECT * FROM businesses WHERE user_id=?', (user['id'],)).fetchone()
        issuer = biz['name'] if biz else 'Employer'
        t = now_ms()
        ids = []
        for i, wid in enumerate(body.ids):
            w = cur.execute('SELECT * FROM workers WHERE id=? AND payer_id=?', (wid, user['id'])).fetchone()
            if not w or w['salary'] <= 0:
                continue
            rid = 'rq%d-%d' % (t, i)
            cur.execute('INSERT INTO requests (id, issuer_id, kind, issuer_type, issuer_name, settlement, note, to_name, phone, email, amount, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        (rid, user['id'], 'trusted', 'employer', issuer, body.settlement, 'Salary', w['name'], w['phone'], w['email'], w['salary'], 'pending', t))
            ids.append(rid)
        return ids
    return {'ids': db.tx(_q)}


@app.get('/escrows')
def list_escrows(user: dict = Depends(require_role('payer'))):
    return db.tx(lambda c: [dict(r) for r in c.execute('SELECT * FROM escrows WHERE payer_id=? ORDER BY created_at DESC', (user['id'],))])


@app.post('/escrows')
def lock_escrow(body: EscrowIn, user: dict = Depends(require_role('payer'))):
    if not body.purpose or body.amount <= 0:
        raise HTTPException(400, 'Purpose + amount required')

    def _q(cur):
        cur.execute('INSERT INTO escrows (payer_id, purpose, amount, beneficiary, partner, release_cond, status, created_at) VALUES (?,?,?,?,?,?,?,?)',
                    (user['id'], body.purpose, body.amount, body.beneficiary, body.partner, body.release_cond, 'locked', now_ms()))
        return cur.lastrowid
    return {'id': db.tx(_q)}


@app.post('/documents')
async def upload_doc(file: UploadFile = File(...), user: dict = Depends(require_role('payer'))):
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, 'File too large (10MB max)')
    name = os.path.basename(file.filename or 'upload')
    dest = os.path.join(UPLOAD_DIR, '%d_%s' % (now_ms(), name))
    with open(dest, 'wb') as f:
        f.write(data)

    def _q(cur):
        cur.execute('INSERT INTO documents (payer_id, name, mime, size, path, created_at) VALUES (?,?,?,?,?,?)',
                    (user['id'], name, file.content_type or '', len(data), dest, now_ms()))
        return cur.lastrowid
    return {'id': db.tx(_q), 'name': name, 'size': len(data)}


@app.get('/documents')
def list_docs(user: dict = Depends(require_role('payer'))):
    return db.tx(lambda c: [dict(r) for r in c.execute('SELECT id, name, mime, size, created_at FROM documents WHERE payer_id=? ORDER BY created_at DESC', (user['id'],))])


@app.get('/documents/{did}/file')
def get_doc(did: int, user: dict = Depends(require_role('payer'))):
    row = db.tx(lambda c: row(c.execute('SELECT * FROM documents WHERE id=? AND payer_id=?', (did, user['id'])).fetchone()))
    if not row:
        raise HTTPException(404, 'Not found')
    return FileResponse(row['path'], filename=row['name'])


@app.delete('/documents/{did}')
def delete_doc(did: int, user: dict = Depends(require_role('payer'))):
    def _q(cur):
        r = cur.execute('SELECT * FROM documents WHERE id=? AND payer_id=?', (did, user['id'])).fetchone()
        if r:
            cur.execute('DELETE FROM documents WHERE id=?', (did,))
            try:
                os.remove(r['path'])
            except OSError:
                pass
        return bool(r)
    if not db.tx(_q):
        raise HTTPException(404, 'Not found')
    return {'ok': True}


# ---------- external bids (relay -> bank) ----------
@app.post('/bids/external')
def external_bid(body: ExternalBidIn, user: dict = Depends(require_user)):
    # Recorded as an auction leg the LP desk can see; simplified to a notification + promise split.
    return {'ok': True, 'note': 'LP pays %s %s directly and takes the claim at discount' % (body.bank, body.acct)}


# ---------- notifications ----------
@app.get('/notifications')
def list_notifs(user: dict = Depends(require_user)):
    phone = user.get('phone') or ''
    return db.tx(lambda c: [dict(r) for r in c.execute(
        'SELECT * FROM notifications WHERE user_id = ? OR (phone != "" AND phone = ?) ORDER BY created_at DESC LIMIT 30', (user['id'], phone))])


@app.post('/notifications/{nid}/accept')
def accept_notif(nid: str, user: dict = Depends(require_user)):
    def _q(cur):
        n = cur.execute('SELECT * FROM notifications WHERE id=?', (nid,)).fetchone()
        if not n:
            raise HTTPException(404, 'Not found')
        cur.execute('UPDATE notifications SET accepted=1 WHERE id=?', (nid,))
        if n['promise_id']:
            cur.execute('UPDATE promises SET accepted=1 WHERE id=?', (n['promise_id'],))
        return True
    db.tx(_q)
    return {'ok': True}


# ---------- admin ----------
@app.get('/admin/overview')
def admin_overview(user: dict = Depends(require_role('admin'))):
    def _q(cur):
        return {
            'pending': cur.execute("SELECT COUNT(*) c FROM requests WHERE status='pending'").fetchone()['c'],
            'approved': cur.execute("SELECT COUNT(*) c FROM requests WHERE status='approved'").fetchone()['c'],
            'rejected': cur.execute("SELECT COUNT(*) c FROM requests WHERE status='rejected'").fetchone()['c'],
            'businesses': cur.execute('SELECT COUNT(*) c FROM businesses WHERE verified=0').fetchone()['c'],
            'promises': cur.execute('SELECT COUNT(*) c FROM promises').fetchone()['c'],
            'volume': cur.execute('SELECT COALESCE(SUM(amount),0) v FROM promises').fetchone()['v'],
        }
    return db.tx(_q)


@app.post('/admin/businesses/{uid}/verify', dependencies=[Depends(require_role('admin'))])
def verify_business(uid: int):
    db.tx(lambda c: c.execute('UPDATE businesses SET verified=1 WHERE user_id=?', (uid,)))
    return {'ok': True}
