import { useEffect, useRef } from 'react'
import { fmt } from '../lib/format'
import { api, reachable } from '../lib/api'

const MIN_PCT = 0
const MAX_PCT = 20
const STEP_PX = 16
const NEVER = 9e15
const STAGES = ['submitted', 'accepted', 'allocated', 'in_progress', 'completed']
const STAGE_LABEL = { submitted: 'Bid sent', accepted: 'Accepted', allocated: 'Cash allocated', in_progress: 'In progress', completed: 'Completed' }
const SELLERS = ['Adaeze O.', 'Chidi M.', 'Fatima K.', 'Tunde A.', 'Ngozi E.', 'Ifeanyi U.']
const FACES = [25000, 40000, 75000, 120000, 200000]
const DATES = ['Sept 30', 'Oct 3', 'Oct 7', 'Oct 12']
const MOOD_TEXT = {
  idle: 'Puppy is asleep. Save a card, then wake it up.',
  watching: 'Watching for promises in your range',
  evaluating: 'Checking a promise against your rules',
  bidding: 'Placing a bid for you',
  waiting: 'Bid sent. Waiting for the seller',
  happy: 'That one worked',
  sad: 'Bid turned down. Still watching',
  attention: 'Needs you: not enough liquidity',
}

const EMPTY_LP = {
  puppy: { on: false, mood: 'idle', phase: 'watching', next: 0, until: 0, target: null, disc: 0 },
  market: [], bids: [], earnings: 0, capital: 500000, log: [], lastSpawn: 0,
}
const getLP = (state) => state.lp || EMPTY_LP
const pick = (a) => a[Math.floor(Math.random() * a.length)]

function newPromise(now) {
  return { id: 'mk' + now + Math.floor(Math.random() * 1000), seller: pick(SELLERS), face: pick(FACES), sellerMax: 1 + Math.floor(Math.random() * 10), settlement: pick(DATES), state: 'available' }
}

// Pure state machine: advances Puppy and every bid based on time. Returns the same object if nothing changed.
function advance(lp, s, now) {
  let changed = false
  const next = { ...lp, puppy: { ...lp.puppy }, market: lp.market.map((m) => ({ ...m })), bids: lp.bids.map((b) => ({ ...b })), log: lp.log }
  const p = next.puppy
  const say = (t) => { next.log = [{ t, at: now }, ...next.log].slice(0, 8); changed = true }

  next.bids.forEach((b) => {
    if (now < b.next) return
    if (b.stage === 'submitted') {
      changed = true
      if (b.willAccept) { b.stage = 'accepted'; b.next = now + 1200; p.mood = 'happy'; p.until = now + 1800; say('Bid accepted: ' + fmt(b.face) + ' from ' + b.seller) }
      else { b.stage = 'rejected'; b.next = NEVER; p.mood = 'sad'; p.until = now + 1800; say(b.seller + ' turned the bid down') }
    } else if (b.stage === 'accepted') {
      b.stage = 'allocated'; b.next = now + 1500; next.capital -= b.pay; say('Liquidity allocated: ' + fmt(b.pay))
    } else if (b.stage === 'allocated') {
      b.stage = 'in_progress'; b.next = now + 3000; changed = true
    } else if (b.stage === 'in_progress') {
      b.stage = 'completed'; b.next = NEVER; next.capital += b.face; next.earnings += b.face - b.pay
      p.mood = 'happy'; p.until = now + 2200; say('Completed: earned ' + fmt(b.face - b.pay))
    }
  })

  if (p.on) {
    if ((p.mood === 'happy' || p.mood === 'sad') && now >= p.until) { p.mood = 'watching'; changed = true }
    const open = next.market.filter((m) => m.state === 'available').length
    if (open < 2 && now - lp.lastSpawn > 5000) {
      const m = newPromise(now)
      next.market = [m, ...next.market].slice(0, 8); next.lastSpawn = now
      say('New promise from ' + m.seller + ': ' + fmt(m.face))
    }
    if (now >= p.next) {
      const busyMood = p.mood === 'happy' || p.mood === 'sad'
      if (p.phase === 'watching') {
        const t = next.market.find((m) => m.state === 'available')
        if (t) { p.phase = 'evaluating'; p.target = t.id; p.next = now + 1500; if (!busyMood) p.mood = 'evaluating'; changed = true }
      } else if (p.phase === 'evaluating') {
        const t = next.market.find((m) => m.id === p.target)
        changed = true
        p.phase = 'watching'; p.next = now + 900
        if (t) {
          const disc = Math.min(s.max, t.sellerMax)
          const pay = Math.round(t.face * (1 - disc / 100))
          if (disc < s.min) { t.state = 'skipped'; t.why = 'Seller stops at ' + t.sellerMax + '%, below your ' + s.min + '% minimum'; if (!busyMood) p.mood = 'watching'; say('Skipped ' + fmt(t.face) + ': outside your range') }
          else if (pay > next.capital) { t.state = 'skipped'; t.why = 'Not enough liquidity'; p.mood = 'attention'; say('Need more liquidity for ' + fmt(t.face)) }
          else { p.phase = 'bidding'; p.disc = disc; p.next = now + 1100; if (!busyMood) p.mood = 'bidding' }
        }
      } else if (p.phase === 'bidding') {
        const t = next.market.find((m) => m.id === p.target)
        changed = true
        if (t) {
          const pay = Math.round(t.face * (1 - p.disc / 100))
          next.bids = [{ id: 'bid' + now, seller: t.seller, face: t.face, disc: p.disc, pay, settlement: t.settlement, stage: 'submitted', next: now + 2600, willAccept: Math.random() > 0.2 }, ...next.bids].slice(0, 12)
          t.state = 'bid'
          say('Bid ' + p.disc + '% on ' + fmt(t.face) + ' from ' + t.seller)
        }
        p.phase = 'watching'; p.next = now + 1600
        if (!busyMood) p.mood = 'waiting'
      }
    }
  }
  return changed ? next : lp
}

const CSS = `
.pp-watching .pp-eyes{animation:pp-look 2.4s ease-in-out infinite}
.pp-evaluating .pp-eyes{animation:pp-scan .7s ease-in-out infinite}
.pp-bidding{animation:pp-pulse .5s ease-in-out infinite}
.pp-happy{animation:pp-hop .6s ease-out 2}
.pp-attention{animation:pp-shake .5s ease-in-out infinite}
.pp-waiting .pp-lamp,.pp-bidding .pp-lamp{animation:pp-blink 1s infinite}
@keyframes pp-look{0%,100%{transform:translateX(-3px)}50%{transform:translateX(3px)}}
@keyframes pp-scan{0%,100%{transform:translateY(-2px)}50%{transform:translateY(2px)}}
@keyframes pp-pulse{50%{transform:scale(1.06)}}
@keyframes pp-hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-8px)}}
@keyframes pp-shake{0%,100%{transform:rotate(0)}25%{transform:rotate(-4deg)}75%{transform:rotate(4deg)}}
@keyframes pp-blink{50%{opacity:.25}}
@keyframes pp-row{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.pp-row{animation:pp-row .35s ease-out}
@media (prefers-reduced-motion:reduce){.pp-bot,.pp-bot *,.pp-row{animation:none!important}}
`

function PuppyBot({ mood }) {
  const off = mood === 'idle'
  const happy = mood === 'happy'
  const sad = mood === 'sad'
  const alert = mood === 'attention'
  const busy = mood === 'evaluating' || mood === 'bidding'
  const eye = alert ? '#f59e0b' : '#38bdf8'
  return (
    <svg viewBox="0 0 80 80" width="92" height="92" className={'pp-bot pp-' + mood} aria-label={'Puppy is ' + mood}>
      <line x1="40" y1="8" x2="40" y2="18" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
      <circle cx="40" cy="7" r="4" className="pp-lamp" fill={alert ? '#f59e0b' : busy ? '#34d399' : '#64748b'} />
      <rect x="6" y="30" width="9" height="20" rx="4" fill="#334155" />
      <rect x="65" y="30" width="9" height="20" rx="4" fill="#334155" />
      <rect x="14" y="18" width="52" height="46" rx="16" fill="#0f172a" />
      <rect x="20" y="28" width="40" height="24" rx="10" fill="#1e293b" />
      {off ? (
        <g stroke="#64748b" strokeWidth="3" strokeLinecap="round"><line x1="27" y1="40" x2="37" y2="40" /><line x1="43" y1="40" x2="53" y2="40" /></g>
      ) : happy ? (
        <g fill="none" stroke={eye} strokeWidth="3" strokeLinecap="round"><path d="M27 43q5-8 10 0" /><path d="M43 43q5-8 10 0" /></g>
      ) : (
        <g className="pp-eyes" fill={eye}><circle cx="32" cy={sad ? 43 : 40} r={sad ? 3 : 4.5} /><circle cx="48" cy={sad ? 43 : 40} r={sad ? 3 : 4.5} /></g>
      )}
      <path d={happy ? 'M33 57q7 6 14 0' : sad ? 'M34 59q6-5 12 0' : 'M35 57h10'} stroke="#94a3b8" fill="none" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

function Wheel({ label, value, lo, hi, onChange }) {
  const el = useRef(null)
  const drag = useRef({ y: null, acc: 0 })
  const live = useRef({ value, lo, hi, onChange })
  live.current = { value, lo, hi, onChange }

  const set = (v) => {
    const c = live.current
    const nv = Math.max(c.lo, Math.min(c.hi, v))
    if (nv !== c.value) {
      c.onChange(nv)
      if (navigator.vibrate) navigator.vibrate(4)
    }
  }

  useEffect(() => {
    const node = el.current
    if (!node) return
    const onWheel = (e) => { e.preventDefault(); set(live.current.value + (e.deltaY < 0 ? 1 : -1)) }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  const down = (e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { y: e.clientY, acc: 0 } }
  const move = (e) => {
    const d = drag.current
    if (d.y === null) return
    d.acc += d.y - e.clientY
    d.y = e.clientY
    const steps = Math.trunc(d.acc / STEP_PX)
    if (steps) { d.acc -= steps * STEP_PX; set(live.current.value + steps) }
  }
  const up = () => { drag.current.y = null }
  const key = (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); set(value + 1) }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); set(value - 1) }
  }

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="font-bold text-[34px] tabular-nums tracking-tight leading-none">{value}%</p>
      <div
        ref={el}
        role="slider"
        tabIndex={0}
        aria-label={label + ' percentage'}
        aria-valuemin={lo}
        aria-valuemax={hi}
        aria-valuenow={value}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        className="relative w-24 h-44 rounded-[40px] border border-slate-300 cursor-grab active:cursor-grabbing overflow-hidden shadow-[0_14px_30px_rgba(15,23,42,0.18),inset_0_2px_0_rgba(255,255,255,0.9)] focus:outline-none focus:ring-2 focus:ring-slate-900"
        style={{
          touchAction: 'none',
          backgroundColor: '#f1f5f9',
          backgroundImage: 'repeating-linear-gradient(to bottom, #94a3b8 0px, #94a3b8 2px, transparent 2px, transparent ' + STEP_PX + 'px)',
          backgroundPositionY: value * STEP_PX + 'px',
          transition: drag.current.y === null ? 'background-position .14s ease-out' : 'none',
        }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, #f1f5f9 0%, rgba(241,245,249,0) 28%, rgba(241,245,249,0) 72%, #f1f5f9 100%)' }} />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white border border-slate-200 shadow-[0_3px_8px_rgba(15,23,42,0.18)] flex items-center justify-center pointer-events-none">
          <div className="w-2 h-2 rounded-full bg-slate-900" />
        </div>
      </div>
      <p className="text-[10px] font-semibold text-slate-400">{lo}% to {hi}%</p>
    </div>
  )
}

// Server snapshot -> local Puppy shape (same state model, real backend truth).
function serverToLocal(snap) {
  const c = snap.config || {}
  return {
    puppy: {
      on: !!c.puppy_on,
      mood: c.puppy_mood || 'idle',
      phase: c.puppy_phase || 'watching',
      next: c.puppy_next || 0,
      until: c.puppy_until || 0,
      target: c.puppy_target || null,
      disc: c.puppy_disc || 0,
    },
    market: (snap.market || []).map((m) => ({
      id: m.id, seller: m.seller, face: m.face, sellerMax: m.seller_max,
      settlement: m.settlement, state: m.state, why: m.why || '',
    })),
    bids: (snap.bids || []).map((b) => ({
      id: b.id, seller: b.seller, face: b.face, disc: b.disc, pay: b.pay,
      settlement: b.settlement, stage: b.stage, next: b.next_at, willAccept: !!b.will_accept,
    })),
    earnings: c.earnings || 0,
    capital: c.capital ?? 500000,
    log: (snap.log || []).map((l) => ({ t: l.t, at: l.at })),
    lastSpawn: c.last_spawn || 0,
  }
}

export default function PuppyDesk({ state, setAppState, onUpdateLPSettings }) {
  const lp = getLP(state)
  const st = state.accounts.personal.lpSettings || {}
  const min = st.minDiscount ?? 2
  const max = st.maxDiscount ?? 8
  const hasCard = !!state.accounts.personal.card
  const running = lp.puppy.on || lp.bids.some((b) => b.next < NEVER)
  const server = useRef(null) // null = unknown, true/false = probed

  useEffect(() => {
    let live = true
    reachable().then((ok) => { if (live) server.current = ok })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      if (server.current) {
        api.puppyTick()
          .then((snap) => setAppState((prev) => ({ ...prev, lp: serverToLocal(snap) })))
          .catch(() => { server.current = false })
        return
      }
      setAppState((prev) => {
        const cur = getLP(prev)
        const s = prev.accounts.personal.lpSettings || {}
        const nx = advance(cur, { min: s.minDiscount ?? 2, max: s.maxDiscount ?? 8 }, Date.now())
        return nx === cur ? prev : { ...prev, lp: nx }
      })
    }, 700)
    return () => clearInterval(id)
  }, [running, setAppState])

  const patch = (fn) => setAppState((prev) => ({ ...prev, lp: fn(getLP(prev)) }))
  const logLine = (cur, t) => [{ t, at: Date.now() }, ...cur.log].slice(0, 8)

  function toggle() {
    if (!lp.puppy.on && !hasCard) return
    if (server.current) {
      // Mirror the switch server-side too; local state still updates below.
      ;(lp.puppy.on ? api.puppyOff() : api.puppyOn()).catch(() => { server.current = false })
    }
    patch((cur) => cur.puppy.on
      ? { ...cur, puppy: { ...cur.puppy, on: false, mood: 'idle', phase: 'watching' }, log: logLine(cur, 'Puppy paused') }
      : { ...cur, puppy: { ...cur.puppy, on: true, mood: 'watching', phase: 'watching', next: Date.now() }, log: logLine(cur, 'Puppy is watching for promises') })
  }
  function sendPromise() {
    if (server.current) api.marketInject().catch(() => { server.current = false })
    patch((cur) => {
      const now = Date.now()
      const m = newPromise(now)
      return { ...cur, market: [m, ...cur.market].slice(0, 8), lastSpawn: now, log: logLine(cur, 'New promise from ' + m.seller + ': ' + fmt(m.face)) }
    })
  }
  function resetDemo() { setAppState((prev) => ({ ...prev, lp: EMPTY_LP })) }

  const active = lp.bids.filter((b) => b.next < NEVER).length
  const completed = lp.bids.filter((b) => b.stage === 'completed').length

  return (
    <div className="space-y-4">
      <style>{CSS}</style>

      <div className="glass-card rounded-[28px] p-5">
        <div className="flex items-center gap-4">
          <PuppyBot mood={lp.puppy.mood} />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Puppy - your bidding agent</p>
            <p className="font-bold text-[16px] tracking-tight mt-0.5">{MOOD_TEXT[lp.puppy.mood]}</p>
            <p className="text-[12px] text-slate-500 mt-1">You set the rules. Puppy bids inside {min}% to {max}%.</p>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={toggle} disabled={!lp.puppy.on && !hasCard} className={'tap-target flex-1 h-11 rounded-2xl text-[13px] font-bold disabled:opacity-40 ' + (lp.puppy.on ? 'bg-white border border-slate-200 text-slate-700' : 'bg-slate-900 text-white')}>
            {lp.puppy.on ? 'Pause Puppy' : 'Wake Puppy'}
          </button>
          <button onClick={sendPromise} className="tap-target h-11 px-4 rounded-2xl bg-white border border-slate-200 text-[13px] font-bold text-slate-700">Send a promise</button>
        </div>
        {!hasCard && <p className="text-[12px] text-amber-700 mt-3">Save a demo card in Payment method below so Puppy can fund bids.</p>}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {[
          { l: 'Available capital', v: fmt(lp.capital) },
          { l: 'Earned', v: fmt(lp.earnings) },
          { l: 'Active bids', v: String(active) },
          { l: 'Completed', v: String(completed) },
        ].map((x) => (
          <div key={x.l} className="glass-card rounded-3xl p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{x.l}</div>
            <div className="font-bold text-[18px] tabular-nums tracking-tight mt-1 truncate">{x.v}</div>
          </div>
        ))}
      </div>

      <div className="glass-card rounded-[28px] p-5">
        <h3 className="font-bold text-[16px] tracking-tight">Bidding range</h3>
        <p className="text-[12px] text-slate-500 mb-4">Drag a wheel, scroll over it, or use the arrow keys.</p>
        <div className="flex justify-around items-start">
          <Wheel label="Min" value={min} lo={MIN_PCT} hi={max} onChange={(v) => onUpdateLPSettings(v, max)} />
          <Wheel label="Max" value={max} lo={min} hi={MAX_PCT} onChange={(v) => onUpdateLPSettings(min, v)} />
        </div>
      </div>

      <div className="glass-card rounded-[28px] p-5">
        <h3 className="font-bold text-[16px] tracking-tight mb-2">Puppy is watching ({lp.market.length})</h3>
        {lp.market.length === 0 && <p className="text-[13px] text-slate-400 text-center py-2">Nothing yet. Wake Puppy or send a promise.</p>}
        <div className="space-y-2">
          {lp.market.map((m) => {
            const fits = Math.min(max, m.sellerMax) >= min
            return (
              <div key={m.id} className="pp-row flex items-center gap-3 p-3 rounded-2xl bg-white/60 border border-slate-100">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[14px] tabular-nums">{fmt(m.face)} <span className="text-slate-400 font-medium">from {m.seller}</span></p>
                  <p className="text-[11.5px] text-slate-400 truncate">{m.state === 'skipped' ? m.why : 'Seller accepts up to ' + m.sellerMax + '% - settles ' + m.settlement}</p>
                </div>
                <span className={'text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg shrink-0 ' + (m.state === 'bid' ? 'bg-slate-900 text-white' : m.state === 'skipped' ? 'bg-slate-100 text-slate-400' : fits ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                  {m.state === 'bid' ? 'Bid placed' : m.state === 'skipped' ? 'Skipped' : fits ? 'In range' : 'Out of range'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="glass-card rounded-[28px] p-5">
        <h3 className="font-bold text-[16px] tracking-tight mb-2">Puppy's bids ({lp.bids.length})</h3>
        {lp.bids.length === 0 && <p className="text-[13px] text-slate-400 text-center py-2">No bids yet.</p>}
        <div className="space-y-2.5">
          {lp.bids.map((b) => {
            const idx = STAGES.indexOf(b.stage)
            return (
              <div key={b.id} className="pp-row rounded-2xl border border-slate-100 bg-white/60 p-3">
                <div className="flex justify-between gap-2 text-[13px]">
                  <span className="font-bold tabular-nums truncate">{fmt(b.face)} <span className="text-slate-400 font-medium">from {b.seller}</span></span>
                  <span className={'font-bold tabular-nums shrink-0 ' + (b.stage === 'rejected' ? 'text-slate-300' : 'text-emerald-700')}>+{fmt(b.face - b.pay)}</span>
                </div>
                <p className="text-[11.5px] text-slate-400">Bid {b.disc}% - pay {fmt(b.pay)} - settles {b.settlement}</p>
                {b.stage === 'rejected' ? (
                  <p className="text-[11.5px] font-bold text-red-600 mt-2">Rejected</p>
                ) : (
                  <div className="mt-2">
                    <div className="flex gap-1">
                      {STAGES.map((s, i) => <div key={s} className={'h-1.5 flex-1 rounded-full transition-colors duration-500 ' + (i <= idx ? 'bg-slate-900' : 'bg-slate-200')} />)}
                    </div>
                    <p className="text-[11px] font-semibold text-slate-500 mt-1.5">{STAGE_LABEL[b.stage]}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="glass-card rounded-[28px] p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-[15px] tracking-tight">Puppy activity</h3>
          <button onClick={resetDemo} className="text-[11px] font-bold text-slate-400 hover:text-slate-700">Reset demo</button>
        </div>
        {lp.log.length === 0 && <p className="text-[13px] text-slate-400">Nothing yet.</p>}
        {lp.log.map((l, i) => (
          <p key={l.at + '-' + i} className="text-[12.5px] text-slate-600 py-1.5 border-b border-slate-100 last:border-b-0">{l.t}</p>
        ))}
      </div>
    </div>
  )
}
