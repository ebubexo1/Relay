import { useState } from 'react'
import IssuePipeline from './IssuePipeline'
import Field from './Field'
import TextInput from './TextInput'
import Btn from './Btn'
import Dot from './Dot'
import { PaymentsSection, DocumentsSection } from './PayerExtras'
import { fmt } from '../lib/format'

const PTABS = [
  { k: 'overview', l: 'Overview', icon: 'ph-bold ph-chart-bar' },
  { k: 'issue', l: 'Issue', icon: 'ph-bold ph-plus' },
  { k: 'business', l: 'Business', icon: 'ph-bold ph-bank' },
  { k: 'workers', l: 'Workers', icon: 'ph-bold ph-users' },
  { k: 'transit', l: 'In-transit', icon: 'ph-bold ph-airplane-tilt' },
  { k: 'escrow', l: 'Escrow', icon: 'ph-bold ph-vault' },
  { k: 'payments', l: 'Payments', icon: 'ph-bold ph-credit-card' },
  { k: 'documents', l: 'Documents', icon: 'ph-bold ph-paperclip' },
]

export default function PayerDashboard({ state, onIssue, onRegisterBusiness, onAddWorker, onRemoveWorker, onPayWorkers, onCreateReceipt, onLockEscrow, onSaveCard, onAddDocument, onRemoveDocument, onRemoveCard }) {
  const [ptab, setPtab] = useState('overview')
  const [showSearch, setShowSearch] = useState(false)
  const [query, setQuery] = useState('')

  const issued = state.payerPromises
  const pending = state.requests.filter((r) => r.status === 'pending')
  const totalIssued = issued.reduce((s, p) => s + p.amount, 0)
  const byKind = (k) => issued.filter((p) => p.kind === k)
  const avgTicket = issued.length ? totalIssued / issued.length : 0
  const maxBar = Math.max(1, ...['trusted', 'in-transit', 'escrow'].map((k) => byKind(k).reduce((s, p) => s + p.amount, 0)))

  const visible = issued.filter((p) => {
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()
    return ((p.to || '') + ' ' + (p.phone || '') + ' ' + (p.issuerName || '') + ' ' + (p.kind || '')).toLowerCase().includes(q)
  })

  return (
    <div className="space-y-4">
      <div className="relative">
        <div id="ptabs" className="flex gap-2 overflow-x-auto no-scrollbar scroll-smooth pr-12">
          {PTABS.map((t) => (
            <button
              key={t.k}
              onClick={() => setPtab(t.k)}
              style={{ flex: '0 0 auto' }}
              className={`tap-target shrink-0 flex items-center gap-2 px-4 h-10 rounded-full text-[12px] font-bold whitespace-nowrap ${ptab === t.k ? 'bg-slate-900 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-500'}`}
            >
              <i className={`${t.icon} text-base`}></i>{t.l}
            </button>
          ))}
        </div>
        <button
          onClick={() => document.getElementById('ptabs').scrollBy({ left: 160, behavior: 'smooth' })}
          className="absolute right-0 top-0 w-10 h-10 rounded-full bg-white border border-slate-200 shadow-md flex items-center justify-center text-slate-700"
          title="More tabs"
        >
          <i className="ph-bold ph-caret-right"></i>
        </button>
      </div>

      {ptab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { l: 'Total issued', v: fmt(totalIssued) },
              { l: 'Promises', v: String(issued.length) },
              { l: 'Pending review', v: String(pending.length) },
              { l: 'Avg ticket', v: fmt(avgTicket) },
            ].map((s) => (
              <div key={s.l} className="glass-card rounded-3xl p-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{s.l}</div>
                <div className="font-bold text-[19px] tabular-nums tracking-tight mt-1 truncate">{s.v}</div>
              </div>
            ))}
          </div>
          <div className="glass-card rounded-[28px] p-5">
            <h3 className="font-bold text-[15px] tracking-tight mb-1">Volume by type</h3>
            <p className="text-[12px] text-slate-400 mb-4">From issued promises on Relay</p>
            {[['trusted', 'Trusted float'], ['in-transit', 'In-transit'], ['escrow', 'Escrow locked']].map(([k, l]) => {
              const v = byKind(k).reduce((s, p) => s + p.amount, 0)
              return (
                <div key={k} className="mb-3.5 last:mb-0">
                  <div className="flex justify-between text-[12px] font-semibold mb-1.5">
                    <span>{l} <span className="text-slate-400">· {byKind(k).length}</span></span>
                    <span className="tabular-nums">{fmt(v)}</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-slate-900 transition-all" style={{ width: (v / maxBar) * 100 + '%' }}></div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="glass-card rounded-[28px] p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-[15px] tracking-tight">Issued ({issued.length})</h3>
              <button onClick={() => setShowSearch((s) => !s)} className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-500 shadow-sm tap-target">
                <i className={`ph-bold ${showSearch ? 'ph-x' : 'ph-magnifying-glass'} text-lg`}></i>
              </button>
            </div>
            {showSearch && (
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone, kind…"
                className="anim-drift-in w-full h-[48px] px-4 mb-3 rounded-2xl border border-slate-200 bg-white/70 text-[14px] font-medium placeholder:text-slate-400 focus:outline-none focus:border-slate-900" />
            )}
            <div className="space-y-2.5 max-h-[380px] overflow-y-auto no-scrollbar">
              {visible.slice(0, 20).map((pp) => (
                <div key={pp.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white/60 border border-slate-100">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-[15px] tabular-nums">{fmt(pp.amount)}</div>
                    <div className="text-[12px] text-slate-500 truncate">To {pp.to}{pp.phone ? ' · ' + pp.phone : ''}</div>
                    <div className="text-[11px] text-slate-400 truncate">{pp.issuerName || ''} · {pp.kind || ''} · {pp.settlement}</div>
                  </div>
                  <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0">
                    <Dot health="healthy" />{pp.status}
                  </span>
                </div>
              ))}
              {visible.length === 0 && <div className="text-[13px] text-slate-400 py-3 text-center">No matches.</div>}
            </div>
          </div>
        </div>
      )}

      {ptab === 'issue' && (
        <div className="glass-card rounded-[28px] p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center">
              <i className="ph-bold ph-plus text-lg"></i>
            </div>
            <div>
              <h3 className="font-bold text-[16px] tracking-tight">New issuance</h3>
              <p className="text-[12px] text-slate-500">Goes to admin verification, then SMS + email</p>
            </div>
          </div>
          <IssuePipeline onIssue={onIssue} />
        </div>
      )}

      {ptab === 'business' && <BusinessForm business={state.business} onRegister={onRegisterBusiness} />}
      {ptab === 'workers' && <Workers workers={state.workers} onAdd={onAddWorker} onRemove={onRemoveWorker} onPay={onPayWorkers} />}
      {ptab === 'transit' && <TransitForm onCreate={onCreateReceipt} />}
      {ptab === 'escrow' && <EscrowSection escrows={state.escrows} onLock={onLockEscrow} />}
      {ptab === 'payments' && <PaymentsSection card={state.accounts.payer ? state.accounts.payer.card : null} onSave={onSaveCard} onRemove={onRemoveCard} />}
      {ptab === 'documents' && <DocumentsSection docs={state.payerDocuments || []} onAdd={onAddDocument} onRemove={onRemoveDocument} />}
    </div>
  )
}

function BusinessForm({ business, onRegister }) {
  const [name, setName] = useState(business.name || '')
  const [rc, setRc] = useState(business.rc || '')
  const [type, setType] = useState(business.type || 'employer')
  return (
    <div className="glass-card rounded-[28px] p-5">
      <h3 className="font-bold text-[16px] tracking-tight">Business registration</h3>
      <p className="text-[12px] text-slate-500 mb-1">Verified businesses issue trusted promises from float.</p>
      {business.name && (
        <div className={`mt-3 mb-1 rounded-2xl px-4 py-3 text-[13px] font-semibold ${business.verified ? 'bg-emerald-50 border border-emerald-100 text-emerald-800' : 'bg-amber-50 border border-amber-100 text-amber-800'}`}>
          {business.name} · RC {business.rc || '—'} · {business.verified ? 'Verified' : 'Pending admin verification'}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 mt-3">
        {['employer', 'bank', 'merchant'].map((t) => (
          <button key={t} onClick={() => setType(t)} className={`tap-target py-2.5 rounded-2xl border text-[12px] font-bold uppercase tracking-wide ${type === t ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-500'}`}>{t}</button>
        ))}
      </div>
      <Field label="Business name"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aethercode Ltd" /></Field>
      <Field label="RC / license number"><TextInput value={rc} onChange={(e) => setRc(e.target.value)} placeholder="e.g. RC 1842204" /></Field>
      <Btn onClick={() => onRegister({ name: name.trim(), rc: rc.trim(), type })}>Submit for verification</Btn>
    </div>
  )
}

function Workers({ workers, onAdd, onRemove, onPay }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [salary, setSalary] = useState('')
  const [sel, setSel] = useState(workers.map((w) => w.id))
  const total = workers.filter((w) => sel.includes(w.id)).reduce((s, w) => s + Number(w.salary || 0), 0)
  return (
    <div className="space-y-4">
      <div className="glass-card rounded-[28px] p-5">
        <h3 className="font-bold text-[16px] tracking-tight">Workers · salary promises</h3>
        <p className="text-[12px] text-slate-500 mb-3">Select workers, pay a salary cycle — goes to verification, then each worker gets SMS.</p>
        <div className="space-y-2 mb-3">
          {workers.map((w) => (
            <div key={w.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white/60 border border-slate-100">
              <button onClick={() => setSel((s) => (s.includes(w.id) ? s.filter((x) => x !== w.id) : [...s, w.id]))}
                className={`tap-target w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 ${sel.includes(w.id) ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-300'}`}>
                {sel.includes(w.id) && <i className="ph-bold ph-check text-sm"></i>}
              </button>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[14px] truncate">{w.name}</p>
                <p className="text-[11.5px] text-slate-400 truncate">{w.phone}{w.email ? ' · ' + w.email : ''}</p>
              </div>
              <p className="font-bold text-[14px] tabular-nums shrink-0">{fmt(Number(w.salary || 0))}</p>
              <button onClick={() => onRemove(w.id)} className="tap-target w-9 h-9 rounded-full text-slate-300 hover:text-red-600 shrink-0"><i className="ph-bold ph-trash"></i></button>
            </div>
          ))}
          {workers.length === 0 && <p className="text-[13px] text-slate-400 text-center py-2">No workers yet.</p>}
        </div>
        <Btn onClick={() => onPay(sel)}>Pay {sel.length} workers · {fmt(total)}</Btn>
      </div>
      <div className="glass-card rounded-[28px] p-5">
        <h3 className="font-bold text-[15px] tracking-tight mb-1">Add worker</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
          <Field label="Full name"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Adaeze O." /></Field>
          <Field label="Monthly salary"><TextInput type="number" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="250000" /></Field>
          <Field label="Phone"><TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803…" /></Field>
          <Field label="Email"><TextInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></Field>
        </div>
        <Btn onClick={() => { onAdd({ name: name.trim(), phone: phone.trim(), email: email.trim(), salary: parseFloat(salary) || 0 }); setName(''); setPhone(''); setEmail(''); setSalary('') }}>Add worker</Btn>
      </div>
    </div>
  )
}

function TransitForm({ onCreate }) {
  const [to, setTo] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [amount, setAmount] = useState('')
  const [ref, setRef] = useState('')
  const [settlement, setSettlement] = useState('')
  return (
    <div className="glass-card rounded-[28px] p-5">
      <h3 className="font-bold text-[16px] tracking-tight">In-transit receipt</h3>
      <p className="text-[12px] text-slate-500 mb-1">Money confirmed but settling later — register the receipt so the recipient spends now.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
        <Field label="Recipient"><TextInput value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. Fatima K." /></Field>
        <Field label="Amount"><TextInput type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="75000" /></Field>
        <Field label="Phone"><TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803…" /></Field>
        <Field label="Email"><TextInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" /></Field>
        <Field label="Transaction reference"><TextInput value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. INTL-2026-991" /></Field>
        <Field label="Expected settlement"><TextInput value={settlement} onChange={(e) => setSettlement(e.target.value)} placeholder="e.g. Oct 3" /></Field>
      </div>
      <Btn onClick={() => { onCreate({ to: to.trim(), phone: phone.trim(), email: email.trim(), amount: parseFloat(amount) || 0, ref: ref.trim(), settlement: settlement.trim() }); setTo(''); setPhone(''); setEmail(''); setAmount(''); setRef(''); setSettlement('') }}>
        Submit receipt for verification
      </Btn>
    </div>
  )
}

function EscrowSection({ escrows, onLock }) {
  const [purpose, setPurpose] = useState('')
  const [amount, setAmount] = useState('')
  const [beneficiary, setBeneficiary] = useState('')
  const [partner, setPartner] = useState('')
  const [release, setRelease] = useState('')
  return (
    <div className="space-y-4">
      <div className="glass-card rounded-[28px] p-5">
        <h3 className="font-bold text-[16px] tracking-tight">Lock funds in escrow</h3>
        <p className="text-[12px] text-slate-500 mb-1">Conditional lock via partner — promises issue against it after admin confirms.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
          <Field label="Purpose"><TextInput value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Sept payroll cover" /></Field>
          <Field label="Amount"><TextInput type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500000" /></Field>
          <Field label="Beneficiary group"><TextInput value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder="e.g. All workers" /></Field>
          <Field label="Partner / lock ID"><TextInput value={partner} onChange={(e) => setPartner(e.target.value)} placeholder="e.g. ESC-88231" /></Field>
        </div>
        <Field label="Release condition"><TextInput value={release} onChange={(e) => setRelease(e.target.value)} placeholder="e.g. Release on Sept 30 payroll" /></Field>
        <Btn onClick={() => { onLock({ purpose: purpose.trim(), amount: parseFloat(amount) || 0, beneficiary: beneficiary.trim(), partner: partner.trim(), release: release.trim() }); setPurpose(''); setAmount(''); setBeneficiary(''); setPartner(''); setRelease('') }}>
          Lock escrow
        </Btn>
      </div>
      {escrows.map((e) => (
        <div key={e.id} className="glass-card rounded-[28px] p-5">
          <div className="flex items-center justify-between">
            <p className="font-bold text-[16px] tabular-nums">{fmt(e.amount)}</p>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg ${e.status === 'locked' ? 'bg-amber-50 text-amber-700 border border-amber-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}>{e.status}</span>
          </div>
          <p className="text-[12.5px] text-slate-500 mt-1">{e.purpose} · {e.beneficiary}</p>
          <p className="text-[11.5px] text-slate-400">{e.partner} · {e.release}</p>
        </div>
      ))}
    </div>
  )
}
