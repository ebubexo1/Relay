// Run from the project root:  node src/lp/lpModel.selftest.mjs
import assert from 'node:assert/strict'
import * as M from './lpModel.js'

const NOW = '2026-10-01T09:00:00Z'
let lp = M.newLPAccount({ legalName: 'Test LP', kind: 'individual', email: 'lp@test.com', phone: '0803', idLast4: '1234', bank: 'GTB', acctLast4: '5678' })

// inactive accounts cannot buy
const claim = { id: 'c1', issuer: 'Aethercode', face: 21000, dueDate: '2026-10-15' }
assert.equal(M.checkPurchase(lp, claim, 20000, NOW).ok, false)

lp = { ...lp, status: 'active', tier: 'T2' }
lp = M.deposit(lp, 100000, NOW)
assert.equal(M.totalCapital(lp), 100000)
assert.equal(M.availableLiquidity(lp, NOW), 100000)

// concentration limit: 40% in one issuer breaches T2's 25%
const big = { id: 'c0', issuer: 'Aethercode', face: 42000, dueDate: '2026-10-15' }
const rej = M.purchase(lp, big, 40000, NOW)
assert.equal(rej.ok, false)
assert.ok(rej.reasons.includes('Too concentrated in this issuer'))

// tenor limit
const far = { id: 'cf', issuer: 'Other', face: 21000, dueDate: '2027-06-01' }
assert.ok(M.checkPurchase(lp, far, 20000, NOW).reasons.includes('Settles too far out for your tier'))

// valid purchase
const buy = M.purchase(lp, claim, 20000, NOW)
assert.equal(buy.ok, true)
lp = buy.lp
assert.equal(M.committed(lp, NOW), 20000)
assert.equal(M.availableLiquidity(lp, NOW), 80000)
assert.equal(M.totalCapital(lp), 100000)
assert.equal(M.expectedReturns(lp), 900) // 1000 discount - 100 fee
assert.equal(Math.round(M.yieldPct(21000, 20000) * 100) / 100, 5)
assert.equal(Math.round(M.annualizedYieldPct(21000, 20000, 14) * 10) / 10, 130.4)

// settlement
lp = M.settle(lp, 'pos-1', '2026-10-15T10:00:00Z')
assert.equal(M.realizedReturns(lp), 900)
assert.equal(M.totalCapital(lp), 100900)
assert.equal(M.committed(lp, NOW), 0)
assert.equal(M.availableLiquidity(lp, NOW), 100900)
const perf = M.performance(lp, NOW)
assert.equal(perf.onTimeRate, 1)
assert.equal(perf.closedCount, 1)

console.log('All LP model checks passed.')
console.log(perf)
