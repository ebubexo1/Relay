// Relay API client — talks to the FastAPI backend when reachable,
// otherwise throws so callers fall back to local demo state.
// Base: VITE_API_URL (Pxxl backend URL in prod) or http://localhost:8000.
const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
const KEY = 'relay:api_token'

export function getToken() {
  try {
    return window.localStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}

export function setToken(t) {
  try {
    if (t) window.localStorage.setItem(KEY, t)
    else window.localStorage.removeItem(KEY)
  } catch {}
}

async function req(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || ('HTTP ' + res.status))
  return data
}

export async function reachable() {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 2500)
    const res = await fetch(BASE + '/health', { signal: ctl.signal })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

export const api = {
  base: BASE,
  register: (phone, pin) => req('/auth/register', { method: 'POST', body: { phone, pin } }),
  registerPayer: (p) => req('/auth/register-payer', { method: 'POST', body: p }),
  login: (identifier, pin) => req('/auth/login', { method: 'POST', body: { identifier, pin } }),
  me: () => req('/me'),
  state: () => req('/state'),
  createAuction: (promise_id) => req('/auctions', { method: 'POST', body: { promise_id } }),
  acceptBid: (auction_id, bid_id) => req('/auctions/' + auction_id + '/accept', { method: 'POST', body: { bid_id } }),
  puppyTick: () => req('/lp/puppy/tick', { method: 'POST' }),
  puppyOn: () => req('/lp/puppy/on', { method: 'POST' }),
  puppyOff: () => req('/lp/puppy/off', { method: 'POST' }),
  lpActivate: () => req('/lp/activate', { method: 'POST' }),
  lpConfig: (min_pct, max_pct) => req('/lp/config', { method: 'PUT', body: { min_pct, max_pct } }),
  lpCard: (last4, name, expiry) => req('/lp/card', { method: 'POST', body: { last4, name, expiry } }),
  marketInject: () => req('/lp/market/inject', { method: 'POST' }),
}
