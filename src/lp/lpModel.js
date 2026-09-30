// Relay liquidity-provider domain model.
// Pure functions only: no React, no storage. Amounts are whole naira,
// dates are ISO strings. Every function takes an `lp` object and returns
// numbers or a NEW lp object (never mutates).

export const LP_STATUS = {
  UNDER_REVIEW: 'under_review',
  ACTIVE: 'active',
  RESTRICTED: 'restricted',
  SUSPENDED: 'suspended',
  REJECTED: 'rejected',
}

// PLACEHOLDER limits: set real numbers before any real money moves.
export const TIERS = {
  T1: { label: 'Starter', exposureCap: 500000, perClaimCap: 50000, perIssuerPct: 30, dailyPurchaseCap: 200000, maxTenorDays: 30 },
  T2: { label: 'Standard', exposureCap: 5000000, perClaimCap: 500000, perIssuerPct: 25, dailyPurchaseCap: 2000000, maxTenorDays: 90 },
  T3: { label: 'Institutional', exposureCap: 50000000, perClaimCap: 5000000, perIssuerPct: 20, dailyPurchaseCap: 20000000, maxTenorDays: 180 },
}

// Platform fee: % of the discount, taken at settlement. Admin-configurable later.
export const PLATFORM_FEE_PCT = 10

const OPEN = ['open', 'due', 'late'] // capital still tied up
const CLOSED = ['settled', 'defaulted']
const sum = (xs) => xs.reduce((s, x) => s + x, 0)

export const daysBetween = (fromIso, toIso) =>
  Math.round((new Date(toIso) - new Date(fromIso)) / 86400000)

/* ---------- account ---------- */

export function newLPAccount({ legalName, kind, email, phone, idLast4, bank, acctLast4 }) {
  return {
    legalName, kind, email, phone, idLast4,
    settlementAccount: { bank, last4: acctLast4 },
    status: LP_STATUS.UNDER_REVIEW,
    tier: 'T1',
    deposited: 0,
    withdrawn: 0,
    pendingWithdrawals: 0,
    settings: { minDiscount: 2, maxDiscount: 8, autoBuy: false, perClaimCap: null },
    positions: [],
    reservations: [], // { id, amount, expiresAt }
    ledger: [], // { id, type, amount, at, ref }
  }
}

/* ---------- capital ---------- */

export const openPositions = (lp) => lp.positions.filter((p) => OPEN.includes(p.status))
export const closedPositions = (lp) => lp.positions.filter((p) => CLOSED.includes(p.status))

export const realizedReturns = (lp) =>
  sum(closedPositions(lp).map((p) => (p.received || 0) - (p.feePaid || 0) - p.paid))

export const totalCapital = (lp) => lp.deposited - lp.withdrawn + realizedReturns(lp)

export const reservedAmount = (lp, nowIso) =>
  sum(lp.reservations.filter((r) => new Date(r.expiresAt) > new Date(nowIso)).map((r) => r.amount))

export const committed = (lp, nowIso) => sum(openPositions(lp).map((p) => p.paid)) + reservedAmount(lp, nowIso)

export const availableLiquidity = (lp, nowIso) =>
  Math.max(0, totalCapital(lp) - committed(lp, nowIso) - lp.pendingWithdrawals)

/* ---------- pricing ---------- */

export const discountPct = (face, paid) => ((face - paid) / face) * 100
export const yieldPct = (face, paid) => ((face - paid) / paid) * 100
export const annualizedYieldPct = (face, paid, days) => (days > 0 ? (yieldPct(face, paid) * 365) / days : 0)
export const platformFee = (face, paid, feePct = PLATFORM_FEE_PCT) =>
  Math.round((Math.max(0, face - paid) * feePct) / 100)
export const netReturn = (face, paid, feePct) => face - paid - platformFee(face, paid, feePct)

export const expectedReturns = (lp) => sum(openPositions(lp).map((p) => netReturn(p.face, p.paid)))

/* ---------- risk ---------- */

export function exposureByIssuer(lp) {
  const out = {}
  openPositions(lp).forEach((p) => { out[p.issuer] = (out[p.issuer] || 0) + p.paid })
  return out
}

/* ---------- matching / limits ---------- */

// claim: { id, issuer, face, dueDate }. Returns { ok, reasons[] }.
export function checkPurchase(lp, claim, price, nowIso) {
  const reasons = []
  const tier = TIERS[lp.tier]
  const today = nowIso.slice(0, 10)

  if (lp.status !== LP_STATUS.ACTIVE) reasons.push('Account is not active')
  if (price > availableLiquidity(lp, nowIso)) reasons.push('Not enough available liquidity')

  const claimCap = Math.min(tier.perClaimCap, lp.settings.perClaimCap == null ? Infinity : lp.settings.perClaimCap)
  if (price > claimCap) reasons.push('Above per-claim limit')

  const total = totalCapital(lp)
  const held = exposureByIssuer(lp)[claim.issuer] || 0
  if (total > 0 && ((held + price) / total) * 100 > tier.perIssuerPct) reasons.push('Too concentrated in this issuer')

  if (committed(lp, nowIso) + price > tier.exposureCap) reasons.push('Above total exposure limit')

  const boughtToday = sum(lp.positions.filter((p) => p.openedAt.slice(0, 10) === today).map((p) => p.paid))
  if (boughtToday + price > tier.dailyPurchaseCap) reasons.push('Above daily purchase limit')

  if (daysBetween(today, claim.dueDate) > tier.maxTenorDays) reasons.push('Settles too far out for your tier')

  const d = discountPct(claim.face, price)
  if (d < lp.settings.minDiscount || d > lp.settings.maxDiscount) reasons.push('Discount outside your range')

  return { ok: reasons.length === 0, reasons }
}

/* ---------- actions (return a new lp) ---------- */

const entry = (lp, type, amount, at, ref) => ({ id: 'l' + (lp.ledger.length + 1), type, amount, at, ref })

export function deposit(lp, amount, nowIso) {
  return { ...lp, deposited: lp.deposited + amount, ledger: [...lp.ledger, entry(lp, 'deposit', amount, nowIso, null)] }
}

export function purchase(lp, claim, price, nowIso) {
  const check = checkPurchase(lp, claim, price, nowIso)
  if (!check.ok) return { ok: false, reasons: check.reasons, lp }
  const position = {
    id: 'pos-' + (lp.positions.length + 1),
    claimId: claim.id, issuer: claim.issuer,
    face: claim.face, paid: price, dueDate: claim.dueDate, openedAt: nowIso,
    status: 'open', received: 0, feePaid: 0, settledOn: null,
  }
  return {
    ok: true, reasons: [],
    lp: { ...lp, positions: [...lp.positions, position], ledger: [...lp.ledger, entry(lp, 'purchase', -price, nowIso, position.id)] },
  }
}

export function settle(lp, positionId, nowIso) {
  const p = lp.positions.find((x) => x.id === positionId)
  if (!p || !OPEN.includes(p.status)) return lp
  const fee = platformFee(p.face, p.paid)
  const closed = { ...p, status: 'settled', received: p.face, feePaid: fee, settledOn: nowIso.slice(0, 10) }
  return {
    ...lp,
    positions: lp.positions.map((x) => (x.id === positionId ? closed : x)),
    ledger: [...lp.ledger, entry(lp, 'settlement', p.face - fee, nowIso, positionId)],
  }
}

/* ---------- performance ---------- */

export function performance(lp, nowIso) {
  const all = lp.positions
  const closed = closedPositions(lp)
  const onTime = closed.filter((p) => p.status === 'settled' && p.settledOn <= p.dueDate)
  const late = all.filter((p) => p.status === 'late' || p.status === 'defaulted' || (p.status === 'settled' && p.settledOn > p.dueDate))
  const paid = sum(all.map((p) => p.paid))
  const total = totalCapital(lp)
  return {
    realized: realizedReturns(lp),
    openCount: openPositions(lp).length,
    closedCount: closed.length,
    onTimeRate: closed.length ? onTime.length / closed.length : null,
    lateRate: all.length ? late.length / all.length : null,
    avgYieldPct: paid ? (sum(all.map((p) => p.face - p.paid)) / paid) * 100 : 0,
    utilizationPct: total > 0 ? (committed(lp, nowIso) / total) * 100 : 0,
  }
}
