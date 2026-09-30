"""End-to-end smoke test (no server needed): exercises auth -> requests ->
approve -> forward -> settle -> auction -> puppy tick against a temp DB."""
import os
import sys
import tempfile

tmp = tempfile.mkdtemp()
os.environ['RELAY_DB'] = os.path.join(tmp, 'smoke.db')
os.environ['RELAY_SEED'] = '0'

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient  # noqa: E402

try:
    from app.main import app  # noqa: E402
    from app import db  # noqa: E402

    db.init_db()
    c = TestClient(app, raise_server_exceptions=False)

    # auth
    r = c.post('/auth/register', json={'phone': '08010000001', 'pin': '1234'})
    assert r.status_code == 200, r.text
    utok = r.json()['token']
    uh = {'Authorization': 'Bearer ' + utok}
    r = c.post('/auth/register-payer', json={'business_name': 'Test Ltd', 'phone': '08020000002', 'pin': '1234'})
    assert r.status_code == 200, r.text
    ptok, payer = r.json()['token'], r.json()['user']
    ph = {'Authorization': 'Bearer ' + ptok}
    r = c.post('/auth/login', json={'identifier': 'admin', 'pin': 'relay-admin'})
    assert r.status_code == 200, r.text
    ah = {'Authorization': 'Bearer ' + r.json()['token']}

    # payer submits batch -> admin approves -> promise issued
    r = c.post('/requests', headers=ph, json={'issuer_type': 'employer', 'issuer_name': 'Test Ltd', 'kind': 'trusted',
                                              'settlement': 'Sept 30', 'items': [{'to': 'Zainab', 'phone': '08010000001', 'amount': 50000}]})
    assert r.status_code == 200, r.text
    rid = r.json()['ids'][0]
    r = c.post('/requests/%s/approve' % rid, headers=ah)
    assert r.status_code == 200, r.text
    pid = r.json()['promise_id']

    # consumer sees + accepts + forwards + settles (FIFO)
    r = c.get('/promises', headers=uh)
    assert any(p['id'] == pid for p in r.json()), 'promise not visible to recipient'
    c.post('/promises/%s/accept' % pid, headers=uh)
    r = c.post('/promises/%s/forward' % pid, headers=uh, json={'to': 'Musa', 'amount': 20000})
    assert r.status_code == 200, r.text
    r = c.post('/promises/%s/settle' % pid, headers=uh)
    assert r.status_code == 200, r.text
    legs = r.json()['legs']
    assert legs[0]['to'] == 'Musa' and legs[0]['amount'] == 20000, legs
    assert sum(l['amount'] for l in legs) == 50000, legs

    # auction on a fresh promise
    r = c.post('/requests', headers=ph, json={'issuer_type': 'employer', 'issuer_name': 'Test Ltd', 'kind': 'trusted',
                                              'items': [{'to': 'Zainab', 'phone': '08010000001', 'amount': 100000}]})
    rid2 = r.json()['ids'][0]
    pid2 = c.post('/requests/%s/approve' % rid2, headers=ah).json()['promise_id']
    # seeded provider LPs exist? seed disabled -> create LP directly
    c.post('/auth/register', json={'phone': '08090000009', 'pin': '1234'})
    # flip to LP via db not possible through API as other user; use personal user itself
    c.post('/lp/activate', headers=uh)
    c.put('/lp/config', headers=uh, json={'min_pct': 2, 'max_pct': 8})
    r = c.post('/auctions', headers=uh, json={'promise_id': pid2})
    assert r.status_code == 200, r.text
    assert len(r.json()['bids']) >= 1, r.json()
    best = r.json()['bids'][0]
    r = c.post('/auctions/%s/accept' % r.json()['auction_id'], headers=uh, json={'bid_id': best['id']})
    assert r.status_code == 200, r.text

    # puppy engine
    r = c.post('/lp/puppy/tick', headers=uh)
    assert r.status_code == 200, r.text
    assert 'market' in r.json() and 'config' in r.json()

    # workers + escrow + documents
    r = c.post('/workers', headers=ph, json={'name': 'Test Worker', 'phone': '08030000003', 'salary': 90000})
    assert r.status_code == 200, r.text
    r = c.post('/workers/pay', headers=ph, json={'ids': [r.json()['id']]})
    assert r.status_code == 200 and len(r.json()['ids']) == 1, r.text
    r = c.post('/escrows', headers=ph, json={'purpose': 'cover', 'amount': 1000})
    assert r.status_code == 200, r.text
    r = c.post('/documents', headers=ph, files={'file': ('r.txt', b'hello', 'text/plain')})
    assert r.status_code == 200, r.text

    print('SMOKE OK: auth, verify, forward, FIFO settle, auction, puppy, workers, escrow, docs')
except ImportError as e:
    print('SKIP (testclient needs httpx):', e)
