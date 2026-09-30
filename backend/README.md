# Relay backend (FastAPI + SQLite)

Single source of truth for auth, promises, verification queue, auctions,
LP/Puppy engine, workers, escrows, documents and notifications. Zero ORM —
stdlib `sqlite3`, one file `relay.db`. Money here is demo money, but the
state machine is real: every visual state maps to a row + status.

## Run locally

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

First boot seeds demo data (staff/admin, demo personal + payer users,
provider LPs, a sample chain, one pending request). Disable with
`RELAY_SEED=0`. Database file: `backend/relay.db` (gitignored).
Uploads land in `backend/uploads/`.

Env vars (same `.env` style as the notify server):

```
RELAY_ADMIN_PASSCODE=relay-admin   # staff login passcode
RELAY_DB=./relay.db                # optional override
RELAY_AUCTION_CUTOFF_MS=900        # auction speed window
TERMII_API_KEY=…  TERMII_SENDER=Relay  TERMII_CHANNEL=dnd
RESEND_API_KEY=…  EMAIL_FROM=Relay <notify@domain.com>
```

API docs (interactive): `http://localhost:8000/docs`

## Demo logins (seeded)

| Role     | Identifier        | PIN / passcode |
| -------- | ----------------- | -------------- |
| Personal | `08031234567`     | `1234`         |
| Payer    | `08055550000`     | `1234`         |
| Admin    | `admin`           | `relay-admin`  |

## Endpoint map

```
GET  /health
POST /auth/register            {phone, pin}                       -> personal
POST /auth/register-payer      {business_name, phone, rc, type, pin}
POST /auth/login               {identifier, pin}                  -> token
GET  /me  |  GET /state  (full snapshot for the signed-in user)

POST /requests  (payer: batch promise requests -> verification queue)
GET  /requests  (admin: all, payer: own)
POST /requests/{id}/approve  (admin: issues promise + Termii/Resend notify)
POST /requests/{id}/reject

GET  /promises
POST /promises/{id}/accept | /decline | /forward {to, amount} | /settle (FIFO)

POST /auctions {promise_id}            -> bids from registered LP ranges,
                                          speed cutoff, best payout first
POST /auctions/{id}/accept {bid_id}    -> closes, credits seller, LP holding
POST /lp/buy {promise_id}              -> instant buy at mid-range

POST /lp/activate  |  PUT /lp/config {min_pct, max_pct}
POST /lp/card {last4, name, expiry} (last4 ONLY, never full PAN) | DELETE /lp/card
POST /lp/puppy/on | /lp/puppy/off | POST /lp/puppy/tick | GET /lp/dashboard
POST /lp/market/inject

PUT  /business  |  GET|POST|DELETE /workers  |  POST /workers/pay
GET|POST /escrows  |  POST|GET|DELETE /documents (+ /documents/{id}/file)

POST /bids/external {promise_id, amount, bank, acct}
GET  /notifications  |  POST /notifications/{id}/accept
GET  /admin/overview  |  POST /admin/businesses/{uid}/verify
```

## Promise lifecycle

`pending (request)` → `verified (promise)` → forwards split it →
`settled` (FIFO legs) | auction `open` → `closed` on accept.
Puppy bids: `submitted` → `accepted` → `allocated` → `in_progress` →
`completed` (or `rejected`).

## Deploy (Pxxl)

Add a third service alongside `web` + `api`:

| Alias     | Base dir  | Start                          | Port |
| --------- | --------- | ------------------------------ | ---- |
| `backend` | `backend` | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` | `8000` |

Set `VITE_API_URL=https://<backend-url>` on the `web` service so the
frontend talks to it. See `PXXL_DEPLOY.md`.
