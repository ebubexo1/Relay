"""Termii SMS + Resend email via stdlib urllib. Demo mode when keys are absent."""
import json
import os
import urllib.request

TERMII_BASE = 'https://api.ng.termii.com'


def to_intl(phone: str) -> str:
    d = ''.join(ch for ch in str(phone or '') if ch.isdigit())
    if d.startswith('0'):
        d = '234' + d[1:]
    return d


def _post(url: str, payload: dict, headers: dict = None, timeout: int = 20):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json', **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode() or '{}')


def send_sms(to: str, message: str):
    key = os.environ.get('TERMII_API_KEY', '')
    if not key:
        return {'ok': True, 'demo': True, 'to': to}
    try:
        data = _post(TERMII_BASE + '/api/sms/send', {
            'api_key': key,
            'to': to_intl(to),
            'from': os.environ.get('TERMII_SENDER', 'Relay'),
            'sms': message,
            'type': 'plain',
            'channel': os.environ.get('TERMII_CHANNEL', 'dnd'),
        })
        return {'ok': True, 'demo': False, **data}
    except Exception as e:  # noqa: BLE001 - surface provider errors to caller
        return {'ok': False, 'demo': False, 'error': str(e)}


def send_email(to: str, subject: str, text: str):
    key = os.environ.get('RESEND_API_KEY', '')
    if not key or not to:
        return {'ok': True, 'demo': True, 'to': to}
    try:
        data = _post('https://api.resend.com/emails', {
            'from': os.environ.get('EMAIL_FROM', 'Relay <noreply@relay.app>'),
            'to': [to],
            'subject': subject,
            'text': text,
        }, headers={'Authorization': 'Bearer ' + key})
        return {'ok': True, 'demo': False, **data}
    except Exception as e:  # noqa: BLE001
        return {'ok': False, 'demo': False, 'error': str(e)}


def notify_issued(phone: str, email: str, name: str, amount: str, issuer: str, ref: str):
    msg = ('Relay — ' + amount + ' from ' + issuer + ' is spendable now. Ref ' + ref
           + '. Set your PIN at relay.app to claim.')
    out = []
    if phone:
        out.append({'channel': 'sms', **send_sms(phone, msg)})
    if email:
        out.append({'channel': 'email', **send_email(
            email, 'You have a spendable Relay promise',
            'Hello ' + (name or 'there') + ',\n\n' + msg + '\n\n— Relay')})
    return out
