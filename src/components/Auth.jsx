import { useState } from 'react'
import TextInput from './TextInput'
import Btn from './Btn'
import LPAuth from './LPAuth'

const DEMO_CODE = '8472'
const DEMO_ADMIN_PASSCODE = 'RELAY-STAFF-2026' // stand-in for real staff provisioning — see note in AdminGate

// ── Entry chooser ──
// Personal and Payer are presented as peers (both are things anyone can sign
// up for). Admin is deliberately NOT a third peer button — it's a small,
// separate link below, because admin access isn't something you self-select
// in a role picker; it's provisioned. This one visual choice is most of what
// makes the three flows feel like genuinely different kinds of accounts
// instead of three tabs of the same thing.
function EntryChooser({ onPick }) {
  return (
    <div className="glass-card rounded-[28px] p-7">
      <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-3 px-1">
        Continue as
      </label>
      <button
        onClick={() => onPick('personal')}
        className="tap-target w-full text-left p-4 rounded-2xl border border-slate-200 bg-white btn-invert flex items-center gap-3 mb-2.5"
      >
        <i className="ph-fill ph-user text-2xl shrink-0"></i>
        <span>
          <span className="block text-[14px] font-bold">Personal account</span>
          <span className="block text-[11.5px] text-slate-400">Receive, spend & forward promises — sign in with your phone</span>
        </span>
      </button>
      <button
        onClick={() => onPick('payer')}
        className="tap-target w-full text-left p-4 rounded-2xl border border-slate-200 bg-white btn-invert flex items-center gap-3"
      >
        <i className="ph-fill ph-bank text-2xl shrink-0"></i>
        <span>
          <span className="block text-[14px] font-bold">Business (Payer) account</span>
          <span className="block text-[11.5px] text-slate-400">Register a business to issue verified promises to people you pay</span>
        </span>
      </button>

      <button
        onClick={() => onPick('lp')}
        className="tap-target w-full text-left p-4 rounded-2xl border border-slate-200 bg-white btn-invert flex items-center gap-3 mt-2.5"
      >
        <i className="ph-fill ph-coins text-2xl shrink-0"></i>
        <span>
          <span className="block text-[14px] font-bold">Liquidity provider</span>
          <span className="block text-[11.5px] text-slate-400">Apply to fund claims and earn a return - verified onboarding</span>
        </span>
      </button>

      <button
        onClick={() => onPick('admin')}
        className="w-full mt-5 text-center text-[11.5px] font-semibold text-slate-400 hover:text-slate-600"
      >
        Staff / admin access
      </button>
    </div>
  )
}

// ── Personal — phone + SMS OTP + PIN (unchanged mechanism, own component) ──
function PersonalAuth({ initialPhone, onBack, onComplete }) {
  const [step, setStep] = useState('phone') // phone | code | pin
  const [phone, setPhone] = useState(initialPhone || '')
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')

  function sendCode() {
    if (phone.replace(/\D/g, '').length < 7) {
      setErr('Enter a valid phone number — it doubles as your Relay account.')
      return
    }
    setErr('')
    setStep('code')
  }

  function verifyCode() {
    if (code.trim() !== DEMO_CODE) {
      setErr('Wrong code. Hint: the demo SMS code is 8472.')
      return
    }
    setErr('')
    setStep('pin')
  }

  function savePin() {
    if (pin.replace(/\D/g, '').length < 4) {
      setErr('Choose at least a 4-digit PIN.')
      return
    }
    onComplete({ phone, pin })
  }

  return (
    <div className="glass-card rounded-[28px] p-7">
      {step === 'phone' && (
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2 px-1">Phone number = account number</label>
          <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 123 4567" inputMode="tel" />
          <div className="mt-4"><Btn onClick={sendCode}>Continue</Btn></div>
          <button onClick={() => onComplete({ phone: phone.trim() || '0803 123 4567', pin: '1234', demo: true })} className="w-full mt-3 text-[13px] font-semibold text-slate-500 hover:text-slate-900">
            Skip — use demo account
          </button>
          <button onClick={onBack} className="w-full mt-2 text-[12.5px] font-semibold text-slate-400 hover:text-slate-600">← Back</button>
        </div>
      )}

      {step === 'code' && (
        <div>
          <div className="rounded-2xl p-3.5 mb-4 bg-slate-100 border border-slate-200 font-medium text-[13px] text-slate-700">
            <span className="font-bold">SMS:</span> Relay — {`₦5,000`} from A is spendable now. Code: <b className="tracking-widest">{DEMO_CODE}</b>. relay.app/c/8472
          </div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2 px-1">SMS code</label>
          <TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="8472" inputMode="numeric" />
          <div className="mt-4"><Btn onClick={verifyCode}>Verify</Btn></div>
          <button onClick={() => setStep('phone')} className="w-full mt-3 text-[13px] font-semibold text-slate-500 hover:text-slate-900">← Change number</button>
        </div>
      )}

      {step === 'pin' && (
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2 px-1">4-digit PIN (2FA on)</label>
          <TextInput type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" inputMode="numeric" />
          <div className="mt-4"><Btn onClick={savePin}>Secure my account</Btn></div>
        </div>
      )}

      {err && <div className="mt-4 rounded-2xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] font-medium text-red-700">{err}</div>}
    </div>
  )
}

// ── Payer — separate business registration, not a role toggle ──
// Distinct fields on purpose: a business identity should not be reachable by
// just tapping a different button inside a personal login. RC number is a
// stand-in for the real verification a payer account would need before it's
// trusted to issue promises (per the concept doc, this is closer to a
// merchant/bank onboarding than a consumer signup).
function PayerAuth({ onBack, onComplete }) {
  const [step, setStep] = useState('form') // form | pin
  const [businessName, setBusinessName] = useState('')
  const [rc, setRc] = useState('')
  const [businessEmail, setBusinessEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')

  function submitForm() {
    if (!businessName.trim()) return setErr('Enter your business name.')
    if (!businessEmail.trim().includes('@')) return setErr('Enter a valid business email.')
    if (phone.replace(/\D/g, '').length < 7) return setErr('Enter a valid business phone number.')
    setErr('')
    setStep('pin')
  }

  function finish() {
    if (pin.replace(/\D/g, '').length < 4) return setErr('Choose at least a 4-digit password/PIN.')
    onComplete({ businessName: businessName.trim(), rc: rc.trim(), businessEmail: businessEmail.trim(), phone, pin })
  }

  return (
    <div className="glass-card rounded-[28px] p-7">
      {step === 'form' && (
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2 px-1">Business name</label>
          <TextInput value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Aethercode Ltd" />
          <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mt-3 mb-2 px-1">RC number (optional, demo)</label>
          <TextInput value={rc} onChange={(e) => setRc(e.target.value)} placeholder="RC 1234567" />
          <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mt-3 mb-2 px-1">Business email</label>
          <TextInput value={businessEmail} onChange={(e) => setBusinessEmail(e.target.value)} placeholder="payroll@aethercode.com" inputMode="email" />
          <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mt-3 mb-2 px-1">Business phone</label>
          <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 000 0000" inputMode="tel" />
          <div className="mt-4"><Btn onClick={submitForm}>Continue</Btn></div>
          <button onClick={onBack} className="w-full mt-3 text-[12.5px] font-semibold text-slate-400 hover:text-slate-600">← Back</button>
        </div>
      )}

      {step === 'pin' && (
        <div>
          <div className="rounded-2xl p-3.5 mb-4 bg-amber-50 border border-amber-100 font-medium text-[12.5px] text-amber-800">
            Demo note: a real payer account would be verified before it can issue promises. This prototype marks new business accounts <b>unverified</b> until an admin approves them.
          </div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2 px-1">Set a password / PIN</label>
          <TextInput type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" inputMode="numeric" />
          <div className="mt-4"><Btn onClick={finish}>Create business account</Btn></div>
        </div>
      )}

      {err && <div className="mt-4 rounded-2xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] font-medium text-red-700">{err}</div>}
    </div>
  )
}

// ── Admin — passcode gate, no self-registration ──
// In a real build this would be an internal, pre-provisioned staff account
// (invite-only, probably SSO) — never a public signup form. For the
// hackathon, a shared passcode stands in for "you were given access," which
// is the important distinction versus a role button anyone can tap.
function AdminGate({ onBack, onComplete }) {
  const [passcode, setPasscode] = useState('')
  const [err, setErr] = useState('')

  function submit() {
    if (passcode.trim() !== DEMO_ADMIN_PASSCODE) {
      setErr('Incorrect passcode. Admin access is provisioned, not self-registered.')
      return
    }
    onComplete()
  }

  return (
    <div className="glass-card rounded-[28px] p-7">
      <div className="rounded-2xl p-3.5 mb-4 bg-slate-100 border border-slate-200 font-medium text-[12.5px] text-slate-600">
        Demo passcode: <b className="tracking-widest">{DEMO_ADMIN_PASSCODE}</b> — stands in for real staff provisioning (invite/SSO) in a production build.
      </div>
      <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2 px-1">Staff passcode</label>
      <TextInput type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="••••••••" />
      <div className="mt-4"><Btn onClick={submit}>Enter admin board</Btn></div>
      <button onClick={onBack} className="w-full mt-3 text-[12.5px] font-semibold text-slate-400 hover:text-slate-600">← Back</button>
      {err && <div className="mt-4 rounded-2xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] font-medium text-red-700">{err}</div>}
    </div>
  )
}

export default function Auth({ initialPhone, onComplete }) {
  const [flow, setFlow] = useState(null) // null | 'personal' | 'payer' | 'admin'

  const headline = {
    null: 'Future money, spendable now.',
    personal: 'Sign in with your phone.',
    payer: 'Register your business to issue promises.',
    lp: 'Apply to become a liquidity provider.',
    admin: 'Staff access — provisioned, not self-serve.',
  }[flow]

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-[420px]">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-slate-900 rounded-[20px] flex items-center justify-center text-white shadow-2xl mb-5">
            <img src="/favicon.svg" alt="Relay" className="w-full h-full rounded-[inherit]" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Relay</h1>
          <p className="text-slate-500 text-sm mt-1.5 text-center">{headline}</p>
        </div>

        {flow === null && <EntryChooser onPick={setFlow} />}

        {flow === 'personal' && (
          <PersonalAuth
            initialPhone={initialPhone}
            onBack={() => setFlow(null)}
            onComplete={({ phone, pin }) => onComplete({ type: 'personal', phone, pin })}
          />
        )}

        {flow === 'payer' && (
          <PayerAuth
            onBack={() => setFlow(null)}
            onComplete={(payer) => onComplete({ type: 'payer', payer })}
          />
        )}

        {flow === 'lp' && (
          <LPAuth
            onBack={() => setFlow(null)}
            onComplete={(result) => onComplete(result)}
          />
        )}

        {flow === 'admin' && (
          <AdminGate
            onBack={() => setFlow(null)}
            onComplete={() => onComplete({ type: 'admin' })}
          />
        )}

        <p className="text-center mt-6 text-[12px] text-slate-400">No app download needed to receive — SMS onboarding, OPay-style.</p>
      </div>
    </div>
  )
}
