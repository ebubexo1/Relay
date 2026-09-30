import { useEffect, useRef, useState } from 'react'
import { fmt } from './lib/format'
import { initialState } from './state/initialState'

import Dot from './components/Dot'
import KV from './components/KV'
import Btn from './components/Btn'
import Field from './components/Field'
import TextInput from './components/TextInput'
import Panel from './components/Panel'
import PanelTitle from './components/PanelTitle'
import Toast from './components/Toast'
import PromiseRow from './components/PromiseRow'
import SplitVisual from './components/SplitVisual'
import ChainSvg from './components/ChainSvg'
import Knob from './components/Knob'
import Auth from './components/Auth'
import Landing from './components/Landing'
import PayerDashboard from './components/PayerDashboard'
import LPDashboard from './components/LPDashboard'
import AdminBoard from './components/AdminBoard'
import ReceiptZoom from './components/ReceiptZoom'
import { notifyIssued } from './lib/notify'
import { api, setToken } from './lib/api'

function loadSaved(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

function saveKey(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export default function App() {
  const [state, setState] = useState(() => {
    const saved = loadSaved('relay:state', null)
    return saved ? { ...initialState(), ...saved } : initialState()
  })
  const [authed, setAuthed] = useState(() => loadSaved('relay:authed', false) === true)
  const [showLanding, setShowLanding] = useState(true)
  const [tab, setTab] = useState(() => loadSaved('relay:tab', 'home')) // home | activity | business | lp | admin | me
  const [busyId, setBusyId] = useState(null)
  const [receipt, setReceipt] = useState(null) // {receipt, nodes} for ZUI viewer
  const [activePanel, setActivePanel] = useState(null) // claim | pay | transfer | chain | liquidity | health | notifications
  const [activeClaimId, setActiveClaimId] = useState(null)
  const [transferMode, setTransferMode] = useState('transfer')
  const [chainDetail, setChainDetail] = useState(null)
  const [liquidityClaimId, setLiquidityClaimId] = useState(null)
  const [toastMsg, setToastMsg] = useState('')
  const [toastShow, setToastShow] = useState(false)
  const [payMode, setPayMode] = useState('relay')
  const [extBank, setExtBank] = useState('')
  const [extAcct, setExtAcct] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState('all')
  const [hideBal, setHideBal] = useState(false)
  const toastTimer = useRef(null)

  useEffect(() => {
    // Uploaded files can be large; if storage is full, keep everything except the files.
    if (!saveKey('relay:state', state)) saveKey('relay:state', { ...state, payerDocuments: [] })
  }, [state])
  useEffect(() => { saveKey('relay:authed', authed) }, [authed])
  useEffect(() => { saveKey('relay:tab', tab) }, [tab])

  function showToast(msg) {
    setToastMsg(msg)
    setToastShow(true)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastShow(false), 2200)
  }

  function closePanel() {
    setActivePanel(null)
  }

  function go(t) {
    if (t === 'business' && state.session?.type !== 'payer') {
      showToast('Business dashboard is for Payer accounts - sign in as a business to access it')
      return
    }
    if (t === 'admin' && state.session?.type !== 'admin') {
      showToast('Admin board is staff-only - sign in with an admin account')
      return
    }
    if (t === 'lp' && !(state.session?.type === 'personal' && state.accounts.personal.isLP)) {
      showToast('Turn on Liquidity Provider mode in your profile to access the LP desk')
      return
    }
    setTab(t)
    closePanel()
    window.scrollTo({ top: 0 })
  }

  const activeClaim = state.promises.find((p) => p.id === activeClaimId)
  const relayTotal = state.promises.reduce((s, p) => s + p.remaining, 0)
  const p8472 = state.promises.find((p) => p.id === 'p-8472')

  const chainSummaryText = (() => {
    if (!p8472 || !p8472.chain || p8472.chain.edges.length === 0) return 'A → B (you) · not yet forwarded'
    const names = ['A', 'B'].concat(p8472.chain.edges.map((e) => e.to))
    return names.join(' → ')
  })()

  /* ---- Transfer ---- */
  const [splitStage, setSplitStage] = useState('before')
  const [pendingAmt, setPendingAmt] = useState(0)
  const [pendingRecipient, setPendingRecipient] = useState('')
  const [amountInput, setAmountInput] = useState('')
  const [recipientInput, setRecipientInput] = useState('')
  const [showSplit, setShowSplit] = useState(false)

  function openTransfer(id, mode) {
    setActiveClaimId(id)
    setTransferMode(mode || 'transfer')
    const p = state.promises.find((x) => x.id === id)
    setRecipientInput(p && p.id === 'p-8472' && (!p.chain || p.chain.edges.length === 0) ? 'C' : p && p.id === 'p-8472' ? 'D' : '')
    setAmountInput('')
    setShowSplit(false)
    setPayMode('relay')
    setActivePanel('transfer')
  }

  function confirmTransfer() {
    const p = state.promises.find((x) => x.id === activeClaimId)
    const amt = parseFloat(amountInput)
    const recipient = recipientInput.trim() || '—'
    if (!p || !amt || amt <= 0 || amt > p.remaining) {
      showToast('Enter an amount up to ' + fmt(p ? p.remaining : 0))
      return
    }
    setPendingAmt(amt)
    setPendingRecipient(recipient)
    setSplitStage('before')
    setShowSplit(true)
    setTimeout(() => setSplitStage('after'), 150)
    setTimeout(() => {
      setState((prev) => {
        const promises = prev.promises.map((pr) => {
          if (pr.id !== activeClaimId) return pr
          const updated = { ...pr, remaining: pr.remaining - amt }
          if (pr.id === 'p-8472') {
            const edges = pr.chain ? pr.chain.edges.slice() : []
            const from = edges.length === 0 ? 'B (you)' : edges[edges.length - 1].to
            edges.push({ from, to: recipient, amount: amt })
            updated.chain = { root: 'A', edges }
          }
          return updated
        })
        return { ...prev, promises }
      })
      showToast(fmt(amt) + ' sent to ' + recipient + ' — spendable now, before settlement')
      setTimeout(() => closePanel(), 700)
    }, 800)
  }

  /* ---- Settle ---- */
  function settleChain() {
    closePanel()
    showToast('Settling…')
    setTimeout(() => {
      setState((prev) => {
        const p = prev.promises.find((x) => x.id === 'p-8472')
        if (!p) return prev
        const edges = p.chain ? p.chain.edges : []
        let totalForwarded = 0
        const newTx = edges.map((e) => {
          totalForwarded += e.amount
          return { amount: e.amount, desc: e.to + ' received (forwarded from Promise #8472)' }
        })
        const toYou = p.amount - totalForwarded
        newTx.unshift({ amount: toYou, desc: 'You received — remaining balance of Promise #8472' })
        const promises = prev.promises.map((pr) => (pr.id === 'p-8472' ? { ...pr, remaining: 0 } : pr))
        showToast('Settled — ' + fmt(p.amount) + ' resolved across ' + (edges.length + 1) + ' recipients, FIFO')
        return {
          ...prev,
          promises,
          transactions: [...newTx, ...prev.transactions],
          available: prev.available + toYou,
        }
      })
    }, 900)
  }

  /* ---- Liquidity / Auction (backend-first, local fallback) ---- */
  const [auctionStage, setAuctionStage] = useState('idle')
  const [offers, setOffers] = useState([])
  const [selectedOffer, setSelectedOffer] = useState(null)
  const [auctionId, setAuctionId] = useState(null)
  const [lqMin, setLqMin] = useState(0)
  const [lqTarget, setLqTarget] = useState(0)

  function openLiquidity(claimId) {
    const target = claimId ? state.promises.find((x) => x.id === claimId) : state.promises.find((x) => x.remaining > 0)
    if (!target) {
      showToast('No spendable claims to cash out')
      return
    }
    setLiquidityClaimId(target.id)
    setAuctionStage('idle')
    setSelectedOffer(null)
    setAuctionId(null)
    setLqMin(Math.round(target.remaining * 0.94))
    setLqTarget(Math.round(target.remaining * 0.985))
    setActivePanel('liquidity')
  }

  async function runAuction() {
    const target = state.promises.find((x) => x.id === liquidityClaimId)
    if (!target) return
    setAuctionStage('searching')

    // Real auction: registered LP ranges bid server-side, speed cutoff,
    // best payout wins. Falls back to the local pool when offline.
    try {
      const r = await api.createAuction(target.id)
      setAuctionId(r.auction_id)
      setOffers(r.bids.map((b) => ({ id: b.id, name: b.bidder_name + ' · ' + b.discount + '%', amount: b.amount, responseMs: b.response_ms })))
      setAuctionStage('offers')
      return
    } catch {
      setAuctionId(null)
    }

    // Simulated LP pool, each with its own accepted discount range.
    // If the signed-in user has LP mode on, their own wheels-based
    // lpSettings participate too - not decorative, actually used here.
    const pool = [
      { name: 'Provider A', min: 2, max: 6 },
      { name: 'Provider B', min: 1, max: 4 },
      { name: 'Provider C', min: 3, max: 9 },
      { name: 'Provider D', min: 4, max: 10 },
    ]
    if (state.accounts.personal.isLP) {
      const { minDiscount = 2, maxDiscount = 8 } = state.accounts.personal.lpSettings || {}
      pool.push({ name: 'You (LP mode)', min: minDiscount, max: maxDiscount })
    }

    // Each LP bids a discount somewhere inside its own accepted range and
    // responds at a simulated speed. Only bids that respond within the
    // cutoff window are considered - the auction clears fast rather than
    // waiting for the slowest provider - then the cheapest (best-for-seller)
    // bid among the timely ones wins. That's the "speed + efficient
    // allocation" behavior in one pass.
    const bids = pool.map((lp) => {
      const discount = lp.min + Math.random() * (lp.max - lp.min)
      const amount = Math.round(target.remaining * (1 - discount / 100))
      const responseMs = 250 + Math.random() * 700
      return { name: lp.name, amount, responseMs }
    })

    const fastCutoff = 900
    const timely = bids.filter((b) => b.responseMs <= fastCutoff)
    const finalBids = (timely.length > 0 ? timely : bids).sort((a, b) => b.amount - a.amount)

    setTimeout(() => {
      setOffers(finalBids)
      setAuctionStage('offers')
    }, fastCutoff)
  }

  async function acceptOffer(pr) {
    if (pr.id && auctionId) {
      try {
        await api.acceptBid(auctionId, pr.id)
      } catch {
        // local state still updates below
      }
    }
    setState((prev) => ({
      ...prev,
      available: prev.available + pr.amount,
      promises: prev.promises.map((p) => (p.id === liquidityClaimId ? { ...p, remaining: 0 } : p)),
    }))
    closePanel()
    showToast('Sold to ' + pr.name + ' for ' + fmt(pr.amount))
  }

  /* ---- Verification queue: payers submit, admin approves, SMS+email fire ---- */
  function issueBatch({ issuerType, issuerName, kind, escrowRef, settlement, items, note }) {
    const t = Date.now()
    const reqs = items.map((r, i) => ({
      id: 'rq' + t + '-' + i,
      kind,
      issuerType,
      issuerName,
      escrowRef,
      settlement: settlement || 'Pending',
      note: note || '',
      to: r.to,
      phone: r.phone || '',
      email: r.email || '',
      amount: r.amount,
      ref: '',
      status: 'pending',
      created: 'now',
    }))
    setState((prev) => ({
      ...prev,
      notifications: [{ id: 'n' + t, text: 'Sent ' + reqs.length + ' promise request' + (reqs.length === 1 ? '' : 's') + ' to the verification board', time: 'now' }, ...prev.notifications],
      requests: [...reqs, ...prev.requests],
    }))
    showToast(reqs.length + ' request' + (reqs.length === 1 ? '' : 's') + ' sent for verification')
    setTimeout(() => closePanel(), 800)
  }

  async function approveRequest(id) {
    const r = state.requests.find((x) => x.id === id)
    if (!r || r.status !== 'pending') return
    setBusyId(id)
    const t = Date.now()
    const kindLabel = r.kind === 'escrow' ? 'Escrow-locked' : r.kind === 'in-transit' ? 'In-transit' : 'Trusted'
    const results = await notifyIssued({ phone: r.phone, email: r.email, name: r.to, amount: fmt(r.amount), issuerName: r.issuerName, ref: r.ref || ('RL-' + t.toString().slice(-6)) })
    const live = results.some((x) => !x.demo && x.ok)
    setState((prev) => ({
      ...prev,
      promises: [
        {
          id: 'p-' + t,
          amount: r.amount,
          remaining: r.amount,
          from: r.issuerName + ' (' + r.issuerType + ')',
          to: r.to,
          label: 'To ' + r.to,
          settlement: r.settlement || 'Pending',
          status: 'verified',
          spendable: true,
          health: r.kind === 'escrow' ? 'attention' : 'healthy',
          kind: r.kind,
          escrowRef: r.escrowRef || '',
          pendingAccept: true,
        },
        ...prev.promises,
      ],
      payerPromises: [
        { id: 'pp' + t, amount: r.amount, to: r.to, phone: r.phone, settlement: r.settlement || 'Pending', status: 'verified', kind: r.kind, issuerType: r.issuerType, issuerName: r.issuerName, escrowRef: r.escrowRef || '' },
        ...prev.payerPromises,
      ],
      notifications: [
        { id: 'n' + t, text: kindLabel + ' promise issued — ' + fmt(r.amount) + ' to ' + r.to + ' via ' + (live ? 'live SMS/email' : 'demo SMS/email'), time: 'now', kind: 'promise', promiseId: 'p-' + t, accepted: false },
        ...prev.notifications,
      ],
      requests: prev.requests.map((x) => (x.id === id ? { ...x, status: 'approved' } : x)),
    }))
    setBusyId(null)
    showToast('Approved — ' + fmt(r.amount) + ' issued to ' + r.to + (live ? ' (live)' : ' (demo)'))
  }

  function rejectRequest(id) {
    setState((prev) => ({ ...prev, requests: prev.requests.map((x) => (x.id === id ? { ...x, status: 'rejected' } : x)) }))
    showToast('Request rejected')
  }

  function approveBusiness() {
    setState((prev) => ({ ...prev, business: { ...prev.business, verified: true } }))
    showToast('Business verified — trusted issuance unlocked')
  }

  function registerBusiness({ name, rc, type }) {
    if (!name) {
      showToast('Add a business name')
      return
    }
    setState((prev) => ({ ...prev, business: { name, rc, type, verified: false } }))
    showToast('Business submitted for verification')
  }

  function addWorker({ name, phone, email, salary }) {
    if (!name || !salary || salary <= 0) {
      showToast('Add worker name + salary')
      return
    }
    const w = { id: 'w' + Date.now(), name, phone, email, salary }
    setState((prev) => ({ ...prev, workers: [...prev.workers, w] }))
    showToast(name + ' added to roster')
  }

  function removeWorker(id) {
    setState((prev) => ({ ...prev, workers: prev.workers.filter((w) => w.id !== id), requests: prev.requests }))
  }

  function payWorkers(ids) {
    const list = state.workers.filter((w) => ids.includes(w.id) && Number(w.salary) > 0)
    if (list.length === 0) {
      showToast('Select at least one worker with salary')
      return
    }
    const t = Date.now()
    const issuerName = state.business.name || 'Employer'
    const reqs = list.map((w, i) => ({
      id: 'rq' + t + '-' + i, kind: 'trusted', issuerType: 'employer', issuerName, escrowRef: '',
      settlement: 'Month end', note: 'Salary', to: w.name, phone: w.phone || '', email: w.email || '',
      amount: Number(w.salary), ref: '', status: 'pending', created: 'now',
    }))
    setState((prev) => ({ ...prev, requests: [...reqs, ...prev.requests] }))
    showToast(list.length + ' salary requests sent for verification')
  }

  function createReceipt({ to, phone, email, amount, ref, settlement }) {
    if (!to || !amount || amount <= 0) {
      showToast('Add recipient + amount')
      return
    }
    const issuerName = state.business.name || 'Payer'
    const r = {
      id: 'rq' + Date.now(), kind: 'in-transit', issuerType: state.business.type || 'other', issuerName, escrowRef: '',
      settlement: settlement || 'Pending', note: '', to, phone: phone || '', email: email || '',
      amount, ref: ref || '', status: 'pending', created: 'now',
    }
    setState((prev) => ({ ...prev, requests: [r, ...prev.requests] }))
    showToast('In-transit receipt submitted for verification')
  }

  function lockEscrow({ purpose, amount, beneficiary, partner, release }) {
    if (!purpose || !amount || amount <= 0) {
      showToast('Add purpose + amount')
      return
    }
    const e = { id: 'es' + Date.now(), purpose, amount, beneficiary, partner, release, status: 'locked' }
    setState((prev) => ({ ...prev, escrows: [e, ...prev.escrows] }))
    showToast(fmt(amount) + ' locked in escrow')
  }

  function buyClaim(id, discountPct) {
    const p = state.promises.find((x) => x.id === id)
    if (!p || p.remaining <= 0) {
      showToast('Claim no longer available')
      return
    }
    const price = Math.round(p.remaining * (1 - discountPct / 100))
    setState((prev) => ({
      ...prev,
      available: prev.available + price,
      promises: prev.promises.map((x) => (x.id === id ? { ...x, remaining: 0 } : x)),
      lpPortfolio: [{ id: 'h' + Date.now(), claimId: id, face: p.remaining, paid: price, label: p.label, settlement: p.settlement }, ...prev.lpPortfolio],
    }))
    showToast('Bought for ' + fmt(price) + ' — collect ' + fmt(p.remaining) + ' on settlement')
  }

  function openReceipt(p) {
    const edges = p.id === 'p-8472' && p.chain ? p.chain.edges : []
    const nodes = [{ name: p.from || 'Issuer', amount: p.amount }, { name: 'You', amount: p.remaining }]
    edges.forEach((e) => nodes.push({ name: e.to, amount: e.amount }))
    setReceipt({
      receipt: {
        amount: p.amount,
        from: p.from,
        to: p.to,
        ref: p.id.toUpperCase(),
        settlement: p.settlement,
        date: new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }),
      },
      nodes,
    })
  }

  function acceptPromise(id) {
    setState((prev) => ({ ...prev, promises: prev.promises.map((p) => (p.id === id ? { ...p, pendingAccept: false } : p)) }))
    showToast('Promise accepted — spendable now')
  }

  function declinePromise(id) {
    setState((prev) => ({ ...prev, promises: prev.promises.filter((p) => p.id !== id) }))
    showToast('Promise declined')
  }

  function sendExternal() {
    const p = state.promises.find((x) => x.id === activeClaimId)
    const amt = parseFloat(amountInput)
    if (!p || !amt || amt <= 0 || amt > p.remaining) {
      showToast('Enter an amount up to ' + fmt(p ? p.remaining : 0))
      return
    }
    if (!extBank.trim() || !extAcct.trim()) {
      showToast('Add bank + account for external payout')
      return
    }
    const bidId = 'xb' + Date.now()
    setState((prev) => ({
      ...prev,
      promises: prev.promises.map((pr) => (pr.id === activeClaimId ? { ...pr, remaining: pr.remaining - amt } : pr)),
      externalBids: [{ id: bidId, claimId: activeClaimId, amount: amt, bank: extBank.trim(), acct: extAcct.trim(), status: 'open — LP pays ' + extAcct.trim() + ' directly, takes claim at discount' }, ...prev.externalBids],
    }))
    showToast('External bid open — LP pays ' + fmt(amt) + ' to ' + extAcct.trim())
    setTimeout(() => closePanel(), 700)
  }

  /* ---- Filtering ---- */
  const spendable = state.promises.filter((p) => p.remaining > 0)
  const visiblePromises = spendable.filter((p) => {
    if (kindFilter !== 'all' && (p.kind || '') !== kindFilter) return false
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()
    return (p.label + ' ' + p.from + ' ' + p.to + ' ' + (p.kind || '') + ' ' + p.settlement).toLowerCase().includes(q)
  })

  if (!authed) {
    if (showLanding) return <Landing onEnter={() => setShowLanding(false)} />
    return (
      <div className="min-h-screen text-slate-900">
        <Auth
          initialPhone={state.accounts.personal.phone}
          onComplete={(result) => {
            // Mirror the account on the backend (best-effort: demo keeps working offline).
            ;(async () => {
              try {
                if (result.type === 'personal') {
                  try {
                    setToken((await api.login(result.phone, result.pin)).token)
                  } catch {
                    setToken((await api.register(result.phone, result.pin)).token)
                  }
                } else if (result.type === 'payer') {
                  setToken((await api.registerPayer({
                    business_name: result.payer.businessName,
                    business_email: result.payer.businessEmail || '',
                    phone: result.payer.phone || '',
                    rc: result.payer.rc || '',
                    business_type: result.payer.businessType || 'employer',
                    pin: result.payer.pin,
                  })).token)
                } else {
                  try {
                    setToken((await api.login('admin', 'relay-admin')).token)
                  } catch {}
                }
              } catch {}
            })()
            setState((prev) => {
              const accounts = { ...prev.accounts }
              let session, user

              if (result.type === 'personal') {
                accounts.personal = { ...prev.accounts.personal, phone: result.phone || prev.accounts.personal.phone, pinSet: true }
                session = { type: 'personal' }
                user = { phone: accounts.personal.phone, relayId: accounts.personal.relayId, name: accounts.personal.name, pinSet: true, role: 'user', isLP: accounts.personal.isLP }
              } else if (result.type === 'payer') {
                const { pin: _discardedPin, ...payerRest } = result.payer
                accounts.payer = { ...payerRest, pinSet: true, verified: false }
                session = { type: 'payer' }
                user = { phone: accounts.payer.phone, businessName: accounts.payer.businessName, businessEmail: accounts.payer.businessEmail, pinSet: true, role: 'payer', verified: false }
              } else {
                session = { type: 'admin' }
                user = { role: 'admin', name: 'Staff' }
              }
              return { ...prev, accounts, session, user }
            })

            const landing = result.type === 'payer' ? 'business' : result.type === 'admin' ? 'admin' : 'home'
            setTab(landing)
            setAuthed(true)
            showToast('Welcome to Relay')
          }}
        />
        {receipt && (
          <ReceiptZoom receipt={receipt.receipt} nodes={receipt.nodes} onClose={() => setReceipt(null)} />
        )}
        <Toast message={toastMsg} show={toastShow} />
      </div>
    )
  }

  function toggleLPMode() {
    const turningOn = !state.accounts.personal.isLP
    setState((prev) => ({
      ...prev,
      accounts: { ...prev.accounts, personal: { ...prev.accounts.personal, isLP: !prev.accounts.personal.isLP } },
      user: { ...prev.user, isLP: !prev.accounts.personal.isLP },
    }))
    if (turningOn) api.lpActivate().catch(() => {})
  }

  function acceptNotification(id) {
    setState((prev) => {
      const notif = prev.notifications.find((n) => n.id === id)
      if (!notif) return prev
      const hasPromise = notif.promiseId && prev.promises.some((p) => p.id === notif.promiseId)
      return {
        ...prev,
        notifications: prev.notifications.map((n) => (n.id === id ? { ...n, accepted: true } : n)),
        promises: hasPromise
          ? prev.promises.map((p) => (p.id === notif.promiseId ? { ...p, pendingAccept: false, spendable: true } : p))
          : prev.promises,
      }
    })
    showToast('Promise accepted - added to your promise list')
  }

  function updateLPSettings(minDiscount, maxDiscount) {
    setState((prev) => ({
      ...prev,
      accounts: { ...prev.accounts, personal: { ...prev.accounts.personal, lpSettings: { minDiscount, maxDiscount } } },
    }))
    api.lpConfig(minDiscount, maxDiscount).catch(() => {})
  }

  function saveLPCard(cardNumber, expiry, name) {
    const digits = cardNumber.replace(/\D/g, '')
    const last4 = digits.slice(-4)
    setState((prev) => ({
      ...prev,
      accounts: { ...prev.accounts, personal: { ...prev.accounts.personal, card: { last4, expiry, name } } },
    }))
    if (last4.length === 4) api.lpCard(last4, name, expiry).catch(() => {})
    showToast('Card on file updated - settlement will route here')
  }

  function saveBusinessCard(cardNumber, expiry, name, uses) {
    const digits = cardNumber.replace(/[^0-9]/g, '')
    const last4 = digits.slice(-4)
    setState((prev) => ({
      ...prev,
      accounts: { ...prev.accounts, payer: { ...(prev.accounts.payer || {}), card: { last4, expiry, name, uses } } },
    }))
    showToast('Business card saved - available for escrow and salary runs')
  }

  function addPayerDocument(doc) {
    setState((prev) => ({ ...prev, payerDocuments: [doc, ...(prev.payerDocuments || [])] }))
    showToast('Uploaded ' + doc.name)
  }

  function removePayerDocument(id) {
    setState((prev) => ({ ...prev, payerDocuments: (prev.payerDocuments || []).filter((d) => d.id !== id) }))
  }

  function removePersonalCard() {
    setState((prev) => {
      const { card, ...rest } = prev.accounts.personal
      return { ...prev, accounts: { ...prev.accounts, personal: rest } }
    })
    showToast('Card removed - Puppy will pause until a new card is saved')
  }

  function removeBusinessCard() {
    setState((prev) => {
      if (!prev.accounts.payer) return prev
      const { card, ...rest } = prev.accounts.payer
      return { ...prev, accounts: { ...prev.accounts, payer: rest } }
    })
    showToast('Business card removed')
  }

  const nav = [
    { key: 'home', label: 'Home', icon: 'ph-fill ph-house' },
    { key: 'activity', label: 'Activity', icon: 'ph-bold ph-receipt' },
    { key: 'cash', label: 'Cash', icon: 'ph-bold ph-banknote', action: () => openLiquidity(null) },
    { key: 'me', label: 'Me', icon: 'ph-bold ph-user' },
  ]

  return (
    <div className="min-h-screen text-slate-900 flex flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-72 shrink-0 min-h-screen glass-panel z-40 p-6 justify-between border-r border-white/60 sticky top-0 h-screen">
        <div>
          <div className="flex items-center gap-3 mb-10 px-2">
            <div className="w-10 h-10 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-lg">
              <img src="/favicon.svg" alt="Relay" className="w-full h-full rounded-[inherit]" />
            </div>
            <div>
              <h1 className="font-bold text-xl tracking-tight leading-none">Relay</h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Future money OS</p>
            </div>
          </div>
          <nav className="space-y-2">
            {[
              { key: 'home', label: 'Home', icon: 'ph-fill ph-house' },
              { key: 'activity', label: 'Activity', icon: 'ph-bold ph-receipt' },
              { key: 'business', label: 'Business', icon: 'ph-bold ph-bank' },
              { key: 'lp', label: 'Liquidity Desk', icon: 'ph-bold ph-banknote' },
              { key: 'admin', label: 'Verification', icon: 'ph-fill ph-shield-check' },
              { key: 'me', label: 'Profile', icon: 'ph-bold ph-user' },
            ].map((n) => (
              <button
                key={n.key}
                onClick={() => go(n.key)}
                className={`w-full flex items-center gap-4 px-4 py-3 rounded-2xl transition-all ${tab === n.key ? 'bg-slate-900 text-white shadow-xl' : 'text-slate-500 hover:bg-white/60 hover:text-slate-900'}`}
              >
                <i className={`${n.icon} text-xl`}></i>
                <span className="font-medium">{n.label}</span>
                {n.key === 'admin' && state.requests.some((r) => r.status === 'pending') && (
                  <span className="ml-auto w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {state.requests.filter((r) => r.status === 'pending').length}
                  </span>
                )}
              </button>
            ))}
            <button
              onClick={() => openLiquidity(null)}
              className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl text-slate-500 hover:bg-white/60 hover:text-slate-900 transition-all"
            >
              <i className="ph-bold ph-cash text-xl"></i>
              <span className="font-medium">Cash out</span>
            </button>
          </nav>
        </div>
        <div className="p-5 rounded-3xl bg-white border border-slate-100 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Spendable now</p>
          <p className="text-xl font-bold tabular-nums tracking-tight mt-1">{fmt(relayTotal)}</p>
          <button onClick={() => go('activity')} className="mt-3 w-full py-2.5 rounded-xl bg-slate-900 text-white text-[13px] font-bold btn-invert">View chain</button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 w-full max-w-[560px] md:max-w-2xl mx-auto px-5 md:px-8 pt-5 md:pt-8 pb-32 md:pb-16">
        {tab === 'home' && (
          <div className="anim-drift-in">
            {/* Header */}
            <header className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="md:hidden w-10 h-10 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-lg">
                  <span className="font-bold text-xl italic">R</span>
                </div>
                <div>
                  <p className="text-[11px] text-slate-400 font-medium">Good day,</p>
                  <h1 className="font-bold text-[19px] tracking-tight leading-tight">{state.user.relayId} · {state.user.phone}</h1>
                </div>
              </div>
              <button onClick={() => setActivePanel('notifications')} className="w-11 h-11 rounded-full glass-card flex items-center justify-center text-slate-600 relative tap-target">
                <i className="ph-bold ph-bell text-xl"></i>
                {state.notifications.length > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{state.notifications.length}</span>
                )}
              </button>
            </header>

            {/* Balance card */}
            <div className="dark-card rounded-[28px] p-6 text-white relative overflow-hidden mb-4">
              <div className="absolute -top-16 -right-16 w-56 h-56 bg-blue-500/20 rounded-full blur-3xl pointer-events-none"></div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Settled balance</p>
                <button onClick={() => setHideBal((h) => !h)} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center tap-target">
                  <i className={`ph-bold ${hideBal ? 'ph-eye-slash' : 'ph-eye'} text-lg`}></i>
                </button>
              </div>
              <p className="fluid-display font-bold tabular-nums mt-1.5">{hideBal ? '••••••' : fmt(state.available)}</p>
              <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Promise balance · spendable</p>
                  <p className="font-bold text-[19px] tabular-nums mt-0.5 text-emerald-300">{hideBal ? '••••••' : fmt(relayTotal)}</p>
                </div>
                <button onClick={() => openLiquidity(null)} className="px-5 h-11 rounded-2xl bg-white text-slate-900 text-[13px] font-bold btn-invert tap-target">Cash out</button>
              </div>
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-4 gap-2 mb-5">
              {[
                { l: 'Send', icon: 'ph-fill ph-paper-plane-tilt', fn: () => setActivePanel('pay') },
                { l: 'Cash out', icon: 'ph-fill ph-banknote', fn: () => openLiquidity(null) },
                { l: 'Top up', icon: 'ph-bold ph-plus', fn: () => showToast('Demo — top-ups arrive as promise units') },
                { l: 'Business', icon: 'ph-fill ph-bank', fn: () => go('business') },
              ].map((a) => (
                <button key={a.l} onClick={a.fn} className="flex flex-col items-center gap-2 tap-target">
                  <span className="w-14 h-14 rounded-3xl glass-card flex items-center justify-center text-slate-900">
                    <i className={`${a.icon} text-2xl`}></i>
                  </span>
                  <span className="text-[11px] font-semibold text-slate-600">{a.l}</span>
                </button>
              ))}
            </div>

            {/* Promises header + collapsible search */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-[17px] tracking-tight">Spendable now</h2>
              <button onClick={() => setShowSearch((s) => !s)} className="h-10 px-4 rounded-full bg-white border border-slate-200 flex items-center gap-2 text-[13px] font-semibold text-slate-600 shadow-sm tap-target">
                <i className={`ph-bold ${showSearch ? 'ph-x' : 'ph-magnifying-glass'}`}></i>
                {showSearch ? 'Close' : 'Search'}
              </button>
            </div>
            {showSearch && (
              <div className="anim-drift-in mb-3">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search promises, senders, dates…"
                  className="w-full h-[52px] px-4 rounded-2xl border border-slate-200 bg-white/80 text-[14px] font-medium placeholder:text-slate-400 placeholder:font-normal focus:outline-none focus:border-slate-900"
                />
                <div className="flex gap-2 mt-2.5 overflow-x-auto no-scrollbar">
                  {[
                    { k: 'all', l: 'All' },
                    { k: 'trusted', l: 'Salary' },
                    { k: 'in-transit', l: 'In-transit' },
                    { k: 'escrow', l: 'Escrow' },
                  ].map((c) => (
                    <button
                      key={c.k}
                      onClick={() => setKindFilter(c.k)}
                      className={`px-4 h-9 rounded-full text-[12px] font-bold whitespace-nowrap tap-target ${kindFilter === c.k ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}
                    >
                      {c.l}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Promise cards */}
            <div className="space-y-2.5">
              {visiblePromises.map((p) => (
                <div key={p.id}>
                  <PromiseRow
                    p={p}
                    onClick={() => {
                      setActiveClaimId(p.id)
                      setActivePanel('claim')
                    }}
                  />
                  {p.pendingAccept && (
                    <div className="flex gap-2 mt-2">
                      <Btn onClick={() => acceptPromise(p.id)}>Accept</Btn>
                      <Btn variant="secondary" onClick={() => declinePromise(p.id)}>Decline</Btn>
                    </div>
                  )}
                </div>
              ))}
              {visiblePromises.length === 0 && (
                <div className="glass-card rounded-3xl p-6 text-center text-[13px] text-slate-400">
                  {spendable.length === 0 ? 'Nothing spendable right now — new promises arrive by SMS.' : 'No matches for this search / filter.'}
                </div>
              )}
            </div>

            {/* Recent activity */}
            <h2 className="font-bold text-[17px] tracking-tight mt-7 mb-3">Recent activity</h2>
            <div className="glass-card rounded-[28px] p-2">
              {state.externalBids.slice(0, 3).map((b) => (
                <div key={b.id} className="flex items-center gap-3 p-3">
                  <div className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                    <i className="ph-fill ph-bank text-xl"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[15px] tabular-nums">{fmt(b.amount)} → {b.bank}</p>
                    <p className="text-[12px] text-slate-400 truncate">{b.status}</p>
                  </div>
                </div>
              ))}
              {state.transactions.slice(0, 5).map((t, i) => (
                <div key={i} className="flex items-center gap-3 p-3">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                    <i className="ph-fill ph-check-circle text-xl"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[15px] tabular-nums">{fmt(t.amount)}</p>
                    <p className="text-[12px] text-slate-400 truncate">{t.desc}</p>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">Settled</span>
                </div>
              ))}
              {state.transactions.length === 0 && state.externalBids.length === 0 && (
                <p className="text-[13px] text-slate-400 text-center py-4">Nothing settled yet — forwards resolve here, FIFO.</p>
              )}
            </div>
          </div>
        )}

        {tab === 'activity' && (
          <div className="anim-drift-in">
            <h1 className="font-bold text-[24px] tracking-tight mb-1">Activity</h1>
            <p className="text-[13px] text-slate-500 mb-5">Every forward, traced to origin. Settlement pays FIFO.</p>

            <div className="glass-card rounded-[28px] p-5 mb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center">
                  <i className="ph-bold ph-git-branch text-lg"></i>
                </div>
                <div>
                  <h3 className="font-bold text-[16px] tracking-tight">Promise #8472 chain</h3>
                  <p className="font-medium text-[12.5px] text-slate-500 break-all">{chainSummaryText}</p>
                </div>
              </div>
              <div className="chain-scroll">
                {p8472 && (
                  <ChainSvg
                    promise={p8472}
                    onNode={(name) => {
                      const edgesIn = [{ from: 'A', to: 'B (you)', amount: 5000 }].concat(p8472.chain ? p8472.chain.edges : []).filter((e) => e.to === name)
                      const edgesOut = (p8472.chain ? p8472.chain.edges : []).filter((e) => e.from === name)
                      const received = edgesIn.reduce((s, e) => s + e.amount, 0)
                      const sent = edgesOut.reduce((s, e) => s + e.amount, 0)
                      setChainDetail({ type: 'node', name, received, sent })
                    }}
                    onEdge={(from, to, amount) => setChainDetail({ type: 'edge', from, to, amount })}
                  />
                )}
              </div>
              {!chainDetail && <p className="text-[12.5px] text-slate-400 mt-1">Tap a node or a line to inspect it.</p>}
              {chainDetail && chainDetail.type === 'node' && (
                <div className="mt-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-1.5">{chainDetail.name}</p>
                  <KV k="Received" v={fmt(chainDetail.received)} />
                  {chainDetail.sent > 0 && <KV k="Forwarded" v={fmt(chainDetail.sent)} />}
                  <KV k="Remaining" v={fmt(chainDetail.received - chainDetail.sent)} />
                </div>
              )}
              {chainDetail && chainDetail.type === 'edge' && (
                <div className="mt-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-1.5">{chainDetail.from} → {chainDetail.to}</p>
                  <KV k="Amount" v={fmt(chainDetail.amount)} />
                  <KV k="Parent claim" v="Promise #8472" />
                  <KV k="Status" v="Pending settlement" />
                </div>
              )}
            </div>

            <div className="glass-card rounded-[28px] p-5">
              <h3 className="font-bold text-[16px] tracking-tight mb-2">Settlements</h3>
              {state.transactions.length === 0 ? (
                <p className="text-[13px] text-slate-400 py-2">Nothing settled yet.</p>
              ) : (
                state.transactions.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 py-3 border-b border-slate-100 last:border-b-0">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[15px] tabular-nums">{fmt(t.amount)}</p>
                      <p className="text-[12px] text-slate-400 truncate">{t.desc}</p>
                    </div>
                    <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">
                      <Dot health="healthy" /> Settled
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'business' && (
          <div className="anim-drift-in">
            <button onClick={() => go('me')} className="md:hidden flex items-center gap-2 text-[13px] font-bold text-slate-500 mb-3 tap-target">
              <i className="ph-bold ph-arrow-left"></i> Back to profile
            </button>
            <h1 className="font-bold text-[24px] tracking-tight mb-1">Business</h1>
            <p className="text-[13px] text-slate-500 mb-5">Issue verified future payments — employer, bank, merchant. Recipients spend before settlement.</p>
            <PayerDashboard
              state={state}
              onIssue={issueBatch}
              onRegisterBusiness={registerBusiness}
              onAddWorker={addWorker}
              onRemoveWorker={removeWorker}
              onPayWorkers={payWorkers}
              onCreateReceipt={createReceipt}
              onLockEscrow={lockEscrow}
              onSaveCard={saveBusinessCard}
              onAddDocument={addPayerDocument}
              onRemoveDocument={removePayerDocument}
              onRemoveCard={removeBusinessCard}
            />
          </div>
        )}

        {tab === 'lp' && (
          <div className="anim-drift-in">
            <h1 className="font-bold text-[24px] tracking-tight mb-1">Liquidity Desk</h1>
            <p className="text-[13px] text-slate-500 mb-5">Buy spendable claims at a discount — collect face value on settlement.</p>
            <LPDashboard state={state} onBuy={buyClaim} onUpdateLPSettings={updateLPSettings} onSaveCard={saveLPCard} onRemoveCard={removePersonalCard} setAppState={setState} />
          </div>
        )}

        {tab === 'admin' && (
          <div className="anim-drift-in">
            <h1 className="font-bold text-[24px] tracking-tight mb-1">Verification Board</h1>
            <p className="text-[13px] text-slate-500 mb-5">Review promise requests — approval issues them by SMS and email.</p>
            <AdminBoard state={state} onApprove={approveRequest} onReject={rejectRequest} onApproveBusiness={approveBusiness} busyId={busyId} showToast={showToast} />
          </div>
        )}

        {tab === 'me' && (
          <div className="anim-drift-in">
            <h1 className="font-bold text-[24px] tracking-tight mb-5">Profile</h1>
            <div className="glass-card rounded-[28px] p-5 flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-full bg-slate-900 text-white flex items-center justify-center text-xl font-bold">B</div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[16px]">{state.user.phone}</p>
                <p className="text-[12px] text-slate-400">Relay ID {state.user.relayId} · PIN {state.user.pinSet ? 'set · 2FA on' : 'not set'}</p>
              </div>
              <button onClick={() => { setAuthed(false); setTab('home') }} className="w-11 h-11 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-500 tap-target" title="Sign out">
                <i className="ph-bold ph-sign-out text-lg"></i>
              </button>
            </div>

            <div className="glass-card rounded-[28px] p-5 mb-4">
              <h3 className="font-bold text-[15px] mb-3">Workspace</h3>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-2">Signed in as · {state.session?.type || 'personal'}</p>
              {state.session?.type === 'personal' ? (
                <button
                  onClick={toggleLPMode}
                  className={`tap-target w-full rounded-2xl border py-3 flex items-center justify-center gap-2 ${state.accounts.personal.isLP ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-500'}`}
                >
                  <i className="ph-fill ph-banknote text-lg"></i>
                  <span className="text-[13px] font-bold">{state.accounts.personal.isLP ? 'Also acting as Liquidity Provider' : 'Also act as Liquidity Provider'}</span>
                </button>
              ) : (
                <p className="text-[12px] text-slate-400">Payer and Admin are separate accounts — sign out and sign in as that account type to switch.</p>
              )}
            </div>

            <button onClick={() => go('business')} className="w-full dark-card rounded-[28px] p-5 text-white flex items-center gap-4 mb-4 text-left">
              <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
                <i className="ph-fill ph-bank text-2xl"></i>
              </div>
              <div className="flex-1">
                <p className="font-bold text-[15px]">Payers dashboard</p>
                <p className="text-[12px] text-slate-400">Issue salary & payouts as spendable promises</p>
              </div>
              <i className="ph-bold ph-caret-right text-slate-400"></i>
            </button>

            <div className="glass-card rounded-[28px] p-5 mb-4">
              <h3 className="font-bold text-[15px] mb-1">How Relay works</h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">1. A bank, merchant or employer confirms money coming to you.<br />2. You get SMS — account auto-created from your phone number.<br />3. Spend or forward the promise before it settles.<br />4. On settlement day, money routes directly to whoever holds each piece — FIFO.</p>
            </div>

            <div className="glass-card rounded-[28px] p-5">
              <h3 className="font-bold text-[15px] mb-3">Notifications · SMS layer</h3>
              {state.notifications.length === 0 ? (
                <p className="text-[13px] text-slate-400">No notifications.</p>
              ) : (
                state.notifications.map((n) => (
                  <div key={n.id} className="py-2.5 border-b border-slate-100 last:border-b-0 text-[13.5px]">
                    <p>{n.text}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{n.time} · SMS + in-app</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full z-50 p-4 pb-6 pointer-events-none">
        <div className="glass-panel pointer-events-auto rounded-[28px] flex justify-around items-center h-[72px] px-2 shadow-2xl">
          <button onClick={() => go('home')} className={`flex flex-col items-center justify-center w-12 h-12 tap-target ${tab === 'home' ? 'text-slate-900' : 'text-slate-400'}`}>
            <i className={`${tab === 'home' ? 'ph-fill ph-house' : 'ph-bold ph-house'} text-2xl`}></i>
          </button>
          <button onClick={() => go('activity')} className={`flex flex-col items-center justify-center w-12 h-12 tap-target ${tab === 'activity' ? 'text-slate-900' : 'text-slate-400'}`}>
            <i className={`${tab === 'activity' ? 'ph-fill ph-receipt' : 'ph-bold ph-receipt'} text-2xl`}></i>
          </button>
          <button onClick={() => setActivePanel('pay')} className="w-14 h-14 -mt-10 bg-slate-900 rounded-full flex items-center justify-center shadow-[0_10px_30px_rgba(15,23,42,0.35)] border-[5px] border-[#eef1f4] hover:-translate-y-1 transition-transform tap-target" aria-label="Pay">
            <i className="ph-bold ph-plus text-white text-xl"></i>
          </button>
          <button onClick={() => openLiquidity(null)} className="flex flex-col items-center justify-center w-12 h-12 text-slate-400 tap-target" aria-label="Cash out">
            <i className="ph-bold ph-banknote text-2xl"></i>
          </button>
          <button onClick={() => go('me')} className={`flex flex-col items-center justify-center w-12 h-12 tap-target ${['me', 'business', 'lp', 'admin'].includes(tab) ? 'text-slate-900' : 'text-slate-400'}`}>
            <i className={`${['me', 'business', 'lp', 'admin'].includes(tab) ? 'ph-fill ph-user' : 'ph-bold ph-user'} text-2xl`}></i>
          </button>
        </div>
      </nav>

      {/* Scrim */}
      <div
        className={`fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[70] transition-opacity duration-200 ${activePanel ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={closePanel}
      ></div>

      {/* Pay picker */}
      <Panel open={activePanel === 'pay'} onClose={closePanel}>
        <PanelTitle>Pay from…</PanelTitle>
        <p className="text-[13px] text-slate-500 mb-4">Choose which spendable balance to pay with.</p>
        <div className="space-y-2.5">
          {spendable.map((p) => (
            <button key={p.id} onClick={() => openTransfer(p.id, 'transfer')} className="w-full text-left glass-card rounded-3xl p-4 flex items-center gap-3 btn-invert">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[16px] tabular-nums">{fmt(p.remaining)}</p>
                <p className="text-[12px] text-slate-500 truncate">{p.label} · {p.settlement}</p>
              </div>
              <i className="ph-bold ph-caret-right text-slate-400"></i>
            </button>
          ))}
          {spendable.length === 0 && <p className="text-[13px] text-slate-400">Nothing spendable right now.</p>}
        </div>
      </Panel>

      {/* Claim detail */}
      <Panel open={activePanel === 'claim'} onClose={closePanel}>
        {activeClaim && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Spendable now</p>
            <p className="font-bold text-[30px] tabular-nums tracking-tight">{fmt(activeClaim.remaining)}</p>
            <div className="mt-2">
              <KV k="From" v={activeClaim.from} />
              <KV k="To" v={activeClaim.to} />
              <KV k="Status" v={<span className="inline-flex items-center"><Dot health={activeClaim.health} />{activeClaim.status}</span>} />
              <KV k="Settlement" v={activeClaim.settlement} />
              <KV k="Type" v={activeClaim.kind || 'claim'} />
            </div>
            <div className="flex gap-2 mt-4 mb-2">
              <Btn onClick={() => openTransfer(activeClaim.id, 'transfer')}>Send</Btn>
              <Btn variant="secondary" onClick={() => openTransfer(activeClaim.id, 'spend')}>Spend</Btn>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Btn variant="secondary" onClick={() => { closePanel(); setTimeout(() => openLiquidity(activeClaim.id), 250) }}>Cash out</Btn>
              <Btn variant="secondary" onClick={() => { setChainDetail(null); setActivePanel('chain') }}>Chain</Btn>
              <Btn variant="secondary" onClick={() => { openReceipt(activeClaim); }}>Receipt</Btn>
              <Btn variant="secondary" onClick={() => setActivePanel('health')}>Health</Btn>
              {activeClaim.id === 'p-8472' && <Btn variant="secondary" onClick={settleChain}>Settle (demo)</Btn>}
            </div>
          </div>
        )}
      </Panel>

      {/* Transfer */}
      <Panel open={activePanel === 'transfer'} onClose={closePanel}>
        {activeClaim && (
          <div>
            <PanelTitle>{transferMode === 'spend' ? 'Spend' : 'Send'} · {fmt(activeClaim.remaining)} available</PanelTitle>
            <div className="grid grid-cols-2 rounded-2xl bg-slate-100 border border-slate-200 text-[12px] font-bold uppercase tracking-wide mb-4 overflow-hidden">
              <button onClick={() => setPayMode('relay')} className={`tap-target py-2.5 ${payMode === 'relay' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>Relay → Relay</button>
              <button onClick={() => setPayMode('external')} className={`tap-target py-2.5 ${payMode === 'external' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>Relay → Bank</button>
            </div>
            <Field label="Amount">
              <TextInput type="number" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} placeholder="e.g. 2000" />
            </Field>
            {payMode === 'relay' ? (
              <Field label="Recipient Relay ID / phone">
                <TextInput type="text" value={recipientInput} onChange={(e) => setRecipientInput(e.target.value)} placeholder="e.g. C / 0803…" />
              </Field>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
                <Field label="Bank">
                  <TextInput type="text" value={extBank} onChange={(e) => setExtBank(e.target.value)} placeholder="e.g. GTBank" />
                </Field>
                <Field label="Account number">
                  <TextInput type="text" value={extAcct} onChange={(e) => setExtAcct(e.target.value)} placeholder="0123456789" />
                </Field>
              </div>
            )}
            {showSplit && payMode === 'relay' && (
              <SplitVisual total={activeClaim.remaining + (splitStage === 'after' ? pendingAmt : 0)} amt={pendingAmt} recipient={pendingRecipient} stage={splitStage} />
            )}
            {payMode === 'relay' ? (
              <Btn className="w-full mt-1" onClick={confirmTransfer}>{transferMode === 'spend' ? 'Spend now' : 'Split & send'}</Btn>
            ) : (
              <Btn className="w-full mt-1" onClick={sendExternal}>Open bid — LP pays bank</Btn>
            )}
            <p className="text-[12.5px] text-slate-500 mt-3 leading-relaxed">
              {payMode === 'relay'
                ? 'The claim splits immediately — your recipient spends it before anything settles. FIFO on settle.'
                : 'A liquidity provider pays the bank account now and takes your claim at a discount.'}
            </p>
          </div>
        )}
      </Panel>

      {/* Chain detail */}
      <Panel open={activePanel === 'chain'} onClose={closePanel}>
        <PanelTitle>Chain · FIFO</PanelTitle>
        <div className="chain-scroll pb-2">
          {p8472 && (
            <ChainSvg
              promise={p8472}
              onNode={(name) => {
                const edgesIn = [{ from: 'A', to: 'B (you)', amount: 5000 }].concat(p8472.chain ? p8472.chain.edges : []).filter((e) => e.to === name)
                const edgesOut = (p8472.chain ? p8472.chain.edges : []).filter((e) => e.from === name)
                const received = edgesIn.reduce((s, e) => s + e.amount, 0)
                const sent = edgesOut.reduce((s, e) => s + e.amount, 0)
                setChainDetail({ type: 'node', name, received, sent })
              }}
              onEdge={(from, to, amount) => setChainDetail({ type: 'edge', from, to, amount })}
            />
          )}
        </div>
        {!chainDetail && <p className="text-[13px] text-slate-400 py-2">Tap a node or a line to inspect it.</p>}
        {chainDetail && chainDetail.type === 'node' && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 mt-3 mb-1">{chainDetail.name}</p>
            <KV k="Received" v={fmt(chainDetail.received)} />
            {chainDetail.sent > 0 && <KV k="Forwarded" v={fmt(chainDetail.sent)} />}
            <KV k="Remaining" v={fmt(chainDetail.received - chainDetail.sent)} />
          </div>
        )}
        {chainDetail && chainDetail.type === 'edge' && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 mt-3 mb-1">{chainDetail.from} → {chainDetail.to}</p>
            <KV k="Amount" v={fmt(chainDetail.amount)} />
            <KV k="Parent claim" v="Promise #8472" />
            <KV k="Status" v="Pending settlement" />
          </div>
        )}
      </Panel>

      {/* Liquidity */}
      <Panel open={activePanel === 'liquidity'} onClose={closePanel}>
        {(() => {
          const target = state.promises.find((x) => x.id === liquidityClaimId)
          if (!target)
            return (
              <div>
                <PanelTitle>Cash out</PanelTitle>
                <p className="text-[13px] text-slate-400 py-2">No spendable claims right now.</p>
              </div>
            )
          return (
            <div>
              <PanelTitle>Cash out - {fmt(target.remaining)}</PanelTitle>
              <KV k="Settlement" v={target.settlement} />
              <KV k="Type" v={target.kind || 'claim'} />
              <div className="mb-3"></div>
              {auctionStage === 'idle' && <Btn className="w-full" onClick={runAuction}>Find cash offers</Btn>}
              {auctionStage === 'searching' && (
                <p className="text-[13px] text-slate-500 flex items-center gap-2 mt-3">
                  <span className="w-2 h-2 rounded-full bg-amber-500 anim-pulse-dot"></span>
                  Searching liquidity providers…
                </p>
              )}
              {auctionStage === 'offers' && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 mt-4 mb-2">{offers.length} provider{offers.length === 1 ? '' : 's'} found</p>
                  <div className="space-y-2">
                    {offers.map((pr) => {
                      const isSel = selectedOffer && selectedOffer.name === pr.name
                      return (
                        <button
                          key={pr.name}
                          onClick={() => setSelectedOffer(pr)}
                          className={`anim-drift-in w-full text-left rounded-2xl px-4 py-3.5 border transition-all ${isSel ? 'bg-slate-900 text-white border-slate-900 shadow-xl' : 'bg-white border-slate-200'}`}
                        >
                          <b className="tabular-nums">{fmt(pr.amount)}</b> <span className={isSel ? 'text-slate-300' : 'text-slate-500'}>— {pr.name}</span>
                        </button>
                      )
                    })}
                  </div>
                  {selectedOffer && (
                    <div className="mt-3">
                      <KV k="You receive" v={fmt(selectedOffer.amount)} />
                      <KV k="Claim value" v={fmt(target.remaining)} />
                      <KV k="Discount" v={fmt(target.remaining - selectedOffer.amount)} />
                      <Btn className="w-full mt-3" onClick={() => acceptOffer(selectedOffer)}>Accept {selectedOffer.name}</Btn>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })()}
      </Panel>

      {/* Health */}
      <Panel open={activePanel === 'health'} onClose={closePanel}>
        {activeClaim &&
          (() => {
            const checks =
              activeClaim.health === 'healthy'
                ? ['Obligation verified', 'Issuer verified', 'Settlement source verified', 'Claim chain intact', 'No conflicting assignments']
                : ['Obligation verified', 'Issuer verified', 'Claim chain intact']
            return (
              <div>
                <PanelTitle>Transaction health</PanelTitle>
                <p className={`inline-flex items-center text-[11px] font-bold uppercase tracking-wider mb-3 ${activeClaim.health === 'healthy' ? 'text-emerald-700' : 'text-amber-700'}`}>
                  <Dot health={activeClaim.health} />
                  {activeClaim.health === 'healthy' ? 'Healthy' : 'Attention'}
                </p>
                {checks.map((c, i) => (
                  <div key={i} className="flex items-center gap-2.5 py-2.5 text-[13.5px] border-b border-slate-100 last:border-b-0">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[11px] font-bold">✓</span>
                    {c}
                  </div>
                ))}
                {activeClaim.health !== 'healthy' && (
                  <p className="text-[13px] text-slate-500 mt-2.5">Settlement source is still confirming — nothing you need to do.</p>
                )}
                <div className="mt-3">
                  <KV k="Settlement" v={activeClaim.settlement} />
                  <KV k="Last checked" v={new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })} />
                </div>
              </div>
            )
          })()}
      </Panel>

      {/* Notifications */}
      <Panel open={activePanel === 'notifications'} onClose={closePanel}>
        <PanelTitle>Notifications</PanelTitle>
        {state.notifications.length === 0 ? (
          <p className="text-[13px] text-slate-400">No notifications.</p>
        ) : (
          state.notifications.map((n) => (
            <div key={n.id} className="py-3 border-b border-slate-100 last:border-b-0 text-[13.5px]">
              <p>{n.text}</p>
              <div className="flex items-center justify-between mt-0.5">
                <p className="text-[11px] text-slate-400">{n.time} · SMS + in-app</p>
                {n.kind === 'promise' && !n.accepted && (
                  <button onClick={() => acceptNotification(n.id)} className="text-[11px] font-bold uppercase tracking-wider text-white bg-slate-900 rounded-full px-3 py-1.5 tap-target">Accept</button>
                )}
                {n.kind === 'promise' && n.accepted && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Accepted</span>
                )}
              </div>
            </div>
          ))
        )}
      </Panel>

      <Toast message={toastMsg} show={toastShow} />
    </div>
  )
}
