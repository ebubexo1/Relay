import { useState } from 'react'
import Field from './Field'
import Btn from './Btn'
import { fmt } from '../lib/format'
import PuppyDesk from './PuppyDesk'
import TextInput from './TextInput'

export default function LPDashboard({ state, onBuy, onUpdateLPSettings, onSaveCard, onRemoveCard, setAppState }) {
  const [cardNumber, setCardNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cardName, setCardName] = useState('')
  const [discount, setDiscount] = useState(3)
  const [selected, setSelected] = useState(null)

  const opportunities = state.promises.filter((p) => p.remaining > 0)
  const portfolio = state.lpPortfolio
  const deployed = portfolio.reduce((s, h) => s + h.paid, 0)
  const face = portfolio.reduce((s, h) => s + h.face, 0)

  const sel = opportunities.find((p) => p.id === selected)
  const price = sel ? Math.round(sel.remaining * (1 - discount / 100)) : 0

  return (
    <div className="space-y-4">
      <PuppyDesk state={state} setAppState={setAppState} onUpdateLPSettings={onUpdateLPSettings} />
      

      <div className="glass-card rounded-[28px] p-5">
        <h3 className="font-bold text-[16px] tracking-tight mb-1">Payment method</h3>
        <p className="text-[12px] text-slate-500 mb-3">Demo only - stores last 4 digits, not the full card. Settlement pays out here.</p>
        {state.accounts.personal.card ? (
          <div className="flex items-center justify-between rounded-2xl bg-slate-50 border border-slate-100 p-4 mb-3">
            <div>
              <p className="font-bold text-[14px]">**** **** **** {state.accounts.personal.card.last4}</p>
              <p className="text-[11.5px] text-slate-400">{state.accounts.personal.card.name} - Exp {state.accounts.personal.card.expiry}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">On file</span>
              <button onClick={onRemoveCard} className="text-[10px] font-bold uppercase tracking-wider text-red-600 hover:text-red-700">Remove</button>
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl p-3 mb-3">No card on file - settlements cannot route to you yet.</p>
        )}
        <Field label="Cardholder name">
          <TextInput value={cardName} onChange={(e) => setCardName(e.target.value)} placeholder="B. Bello" />
        </Field>
        <Field label="Card number">
          <TextInput value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="4111 1111 1111 1111" inputMode="numeric" />
        </Field>
        <Field label="Expiry (MM/YY)">
          <TextInput value={expiry} onChange={(e) => setExpiry(e.target.value)} placeholder="09/28" />
        </Field>
        <Btn className="mt-2" onClick={() => { onSaveCard(cardNumber, expiry, cardName); setCardNumber(''); }}>Save card</Btn>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {[
          { l: 'Deployed', v: fmt(deployed) },
          { l: 'Face value', v: fmt(face) },
          { l: 'Expected gain', v: fmt(face - deployed) },
        ].map((s) => (
          <div key={s.l} className="glass-card rounded-3xl p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{s.l}</div>
            <div className="font-bold text-[16px] tabular-nums tracking-tight mt-1 truncate">{s.v}</div>
          </div>
        ))}
      </div>

      <div className="glass-card rounded-[28px] p-5">
        <h3 className="font-bold text-[16px] tracking-tight">Buy opportunities</h3>
        <p className="text-[12px] text-slate-500 mb-3">Live spendable claims — buy at a discount, collect face on settlement. Same logic as bond discount rates.</p>
        <div className="space-y-2.5">
          {opportunities.map((p) => (
            <button key={p.id} onClick={() => setSelected(selected === p.id ? null : p.id)}
              className={`w-full text-left rounded-2xl p-4 border transition-all ${selected === p.id ? 'bg-slate-900 text-white border-slate-900 shadow-xl' : 'bg-white/60 border-slate-100'}`}>
              <div className="flex justify-between items-center gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-[15px] tabular-nums">{fmt(p.remaining)}</p>
                  <p className={`text-[12px] truncate ${selected === p.id ? 'text-slate-300' : 'text-slate-500'}`}>{p.label} · {p.settlement}</p>
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg shrink-0 ${selected === p.id ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-500'}`}>{p.kind || 'claim'}</span>
              </div>
            </button>
          ))}
          {opportunities.length === 0 && <p className="text-[13px] text-slate-400 text-center py-2">No open claims right now.</p>}
        </div>

        {sel && (
          <div className="anim-drift-in mt-4 rounded-2xl bg-slate-50 border border-slate-100 p-4">
            <Field label={'Discount % (you pay ' + fmt(price) + ' for ' + fmt(sel.remaining) + ')'}>
              <input type="range" min={1} max={10} step={0.5} value={discount} onChange={(e) => setDiscount(parseFloat(e.target.value))} className="w-full accent-slate-900" />
            </Field>
            <div className="flex justify-between text-[12.5px] font-semibold mb-3">
              <span>You pay <b className="tabular-nums">{fmt(price)}</b></span>
              <span className="text-emerald-700">Gain <b className="tabular-nums">{fmt(sel.remaining - price)}</b></span>
            </div>
            <Btn onClick={() => { onBuy(sel.id, discount); setSelected(null) }}>Buy claim at {discount}% off</Btn>
          </div>
        )}
      </div>

      {portfolio.length > 0 && (
        <div className="glass-card rounded-[28px] p-5">
          <h3 className="font-bold text-[16px] tracking-tight mb-2">Holdings ({portfolio.length})</h3>
          {portfolio.map((h) => (
            <div key={h.id} className="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-b-0">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[14px] tabular-nums">{fmt(h.face)} <span className="text-slate-400 font-medium">· paid {fmt(h.paid)}</span></p>
                <p className="text-[11.5px] text-slate-400 truncate">{h.label} · {h.settlement}</p>
              </div>
              <span className="text-[11px] font-bold text-emerald-700 tabular-nums shrink-0">+{fmt(h.face - h.paid)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
