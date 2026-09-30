import { useState } from 'react'
import TextInput from './TextInput'
import Btn from './Btn'
import { newLPAccount, TIERS } from '../lp/lpModel'

const LABEL = 'block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2 px-1'
const STEPS = ['Profile', 'Verification', 'Agreement', 'Funding']
const digits = (s) => s.replace(/\D/g, '')

// Dedicated Liquidity Provider registration. Separate from Personal and Payer.
// Calls onComplete({ type: 'lp', lp, pin, demo? }). The PIN is returned
// separately and is never stored on the lp object.
export default function LPAuth({ onBack, onComplete }) {
  const [step, setStep] = useState(0)
  const [err, setErr] = useState('')
  const [lp, setLp] = useState(null)
  const [f, setF] = useState({
    kind: 'individual', legalName: '', email: '', phone: '', pin: '',
    idNumber: '', risk: false, fees: false, bank: '', acct: '',
  })
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const flip = (k) => () => setF((p) => ({ ...p, [k]: !p[k] }))

  function problem() {
    if (step === 0) {
      if (!f.legalName.trim()) return 'Enter your legal name (or the entity name).'
      if (!f.email.includes('@')) return 'Enter a valid email - it is your sign-in for the Liquidity Desk.'
      if (digits(f.phone).length < 7) return 'Enter a valid phone number.'
      if (digits(f.pin).length < 6) return 'Choose a PIN of at least 6 digits.'
    }
    if (step === 1 && f.idNumber.trim().length < 6) {
      return f.kind === 'entity' ? 'Enter the entity registration (RC) number.' : 'Enter your BVN or national ID number.'
    }
    if (step === 2 && !(f.risk && f.fees)) return 'Accept both the risk disclosure and the fee schedule to continue.'
    if (step === 3) {
      if (!f.bank.trim()) return 'Enter the bank for settlements.'
      if (digits(f.acct).length < 10) return 'Enter a 10-digit settlement account number.'
    }
    return ''
  }

  function next() {
    const p = problem()
    if (p) { setErr(p); return }
    setErr('')
    if (step < 3) { setStep(step + 1); return }
    setLp(newLPAccount({
      legalName: f.legalName.trim(), kind: f.kind, email: f.email.trim(), phone: f.phone.trim(),
      idLast4: digits(f.idNumber).slice(-4), bank: f.bank.trim(), acctLast4: digits(f.acct).slice(-4),
    }))
    setStep(4)
  }

  function back() {
    setErr('')
    if (step === 0) onBack()
    else setStep(step - 1)
  }

  if (step === 4 && lp) {
    return (
      <div className="glass-card rounded-[28px] p-7">
        <p className={LABEL}>Application submitted</p>
        <h2 className="font-bold text-[18px] tracking-tight mb-1">Under review</h2>
        <p className="text-[13px] text-slate-500 mb-4">
          Relay staff verify every liquidity provider before they can buy claims. You start on the {TIERS[lp.tier].label} tier, with its own limits. Limits rise as your account builds a record.
        </p>
        <Btn onClick={() => onComplete({ type: 'lp', lp, pin: f.pin })}>Go to my Liquidity Desk</Btn>
        <button
          onClick={() => onComplete({ type: 'lp', lp: { ...lp, status: 'active' }, pin: f.pin, demo: true })}
          className="w-full mt-3 text-[13px] font-semibold text-slate-500 hover:text-slate-900"
        >
          Skip staff review - demo only
        </button>
      </div>
    )
  }

  return (
    <div className="glass-card rounded-[28px] p-7">
      <p className="text-[11px] font-bold text-slate-400 mb-1">Liquidity provider application - step {step + 1} of 4</p>
      <h2 className="font-bold text-[18px] tracking-tight mb-4">{STEPS[step]}</h2>

      {step === 0 && (
        <div className="space-y-3">
          <div className="flex gap-2">
            {['individual', 'entity'].map((k) => (
              <button
                key={k}
                onClick={() => setF((p) => ({ ...p, kind: k }))}
                className={`flex-1 py-2.5 rounded-xl text-[13px] font-bold border ${f.kind === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}
              >
                {k === 'individual' ? 'Individual' : 'Company / fund'}
              </button>
            ))}
          </div>
          <div><label className={LABEL}>Legal name</label><TextInput value={f.legalName} onChange={set('legalName')} placeholder="Full legal name" /></div>
          <div><label className={LABEL}>Email (your sign-in)</label><TextInput value={f.email} onChange={set('email')} placeholder="you@example.com" /></div>
          <div><label className={LABEL}>Phone</label><TextInput value={f.phone} onChange={set('phone')} placeholder="0803 123 4567" inputMode="tel" /></div>
          <div><label className={LABEL}>PIN (6+ digits)</label><TextInput value={f.pin} onChange={set('pin')} placeholder="******" inputMode="numeric" /></div>
        </div>
      )}

      {step === 1 && (
        <div>
          <p className="text-[12.5px] text-slate-500 mb-3">
            Liquidity providers handle other people's money, so identity is checked before any claim can be bought. Only the last 4 digits are kept on the account.
          </p>
          <label className={LABEL}>{f.kind === 'entity' ? 'RC number' : 'BVN or national ID'}</label>
          <TextInput value={f.idNumber} onChange={set('idNumber')} placeholder={f.kind === 'entity' ? 'RC1234567' : '11-digit number'} />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3 text-[13px] text-slate-600">
          <label className="flex gap-3 items-start"><input type="checkbox" checked={f.risk} onChange={flip('risk')} className="mt-1" />
            <span>I understand that a claim can settle late or not at all, and that I can lose part or all of the price I paid.</span></label>
          <label className="flex gap-3 items-start"><input type="checkbox" checked={f.fees} onChange={flip('fees')} className="mt-1" />
            <span>I accept the fee schedule: Relay takes a share of the discount when a claim settles.</span></label>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <p className="text-[12.5px] text-slate-500">Settlements and withdrawals are paid only to this account.</p>
          <div><label className={LABEL}>Bank</label><TextInput value={f.bank} onChange={set('bank')} placeholder="e.g. GTBank" /></div>
          <div><label className={LABEL}>Account number</label><TextInput value={f.acct} onChange={set('acct')} placeholder="10 digits" inputMode="numeric" /></div>
        </div>
      )}

      {err && <p className="text-[12.5px] text-red-600 mt-3 px-1">{err}</p>}
      <div className="mt-4"><Btn onClick={next}>{step === 3 ? 'Submit application' : 'Continue'}</Btn></div>
      <button onClick={back} className="w-full mt-2 text-[12.5px] font-semibold text-slate-400 hover:text-slate-600">Back</button>
    </div>
  )
}
