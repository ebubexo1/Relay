// Single source of truth for what each account type is, where it lands,
// which screens (tabs) it may open, and what it may do.
// Keys match state.session.type: 'personal' | 'payer' | 'lp' | 'admin'.

export const ROLES = {
  personal: {
    label: 'Personal account',
    landing: 'home',
    nav: [
      { key: 'home', label: 'Home', icon: 'ph-fill ph-house' },
      { key: 'activity', label: 'Activity', icon: 'ph-bold ph-receipt' },
      { key: 'me', label: 'Profile', icon: 'ph-bold ph-user' },
    ],
    can: ['receive', 'spend', 'forward', 'cash_out'],
  },
  payer: {
    label: 'Business account',
    landing: 'business',
    nav: [{ key: 'business', label: 'Business', icon: 'ph-bold ph-bank' }],
    can: ['issue_promises', 'pay_workers', 'lock_escrow', 'manage_documents'],
  },
  lp: {
    label: 'Liquidity provider',
    landing: 'lp',
    nav: [{ key: 'lp', label: 'Liquidity Desk', icon: 'ph-bold ph-banknote' }],
    can: ['buy_claims', 'set_limits', 'withdraw', 'view_performance'],
  },
  admin: {
    label: 'Staff',
    landing: 'admin',
    nav: [{ key: 'admin', label: 'Verification', icon: 'ph-fill ph-shield-check' }],
    can: ['approve_accounts', 'review_requests', 'freeze_accounts'],
  },
}

export function landingFor(type) {
  return ROLES[type] ? ROLES[type].landing : null
}

export function navFor(type) {
  return ROLES[type] ? ROLES[type].nav : []
}

export function canAccess(type, tab) {
  return !!ROLES[type] && ROLES[type].nav.some((n) => n.key === tab)
}

export function can(type, action) {
  return !!ROLES[type] && ROLES[type].can.includes(action)
}
