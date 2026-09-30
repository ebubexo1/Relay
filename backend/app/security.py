"""Passwords/PINs (pbkdf2, stdlib) + bearer tokens. No extra deps."""
import hashlib
import os
import secrets
import time

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import db

bearer = HTTPBearer(auto_error=False)
SESSION_TTL = 30 * 24 * 3600


def hash_pin(pin: str, salt: str = None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', pin.encode(), salt.encode(), 200_000).hex()
    return digest, salt


def check_pin(pin: str, digest: str, salt: str) -> bool:
    if not digest or not salt:
        return False
    calc, _ = hash_pin(pin, salt)
    return secrets.compare_digest(calc, digest)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def create_session(user_id: int) -> str:
    token = new_token()
    db.tx(lambda c: c.execute(
        'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
        (token, user_id, int(time.time()) + SESSION_TTL)))
    return token


def get_user(token: str):
    def _q(cur):
        row = cur.execute(
            'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id '
            'WHERE s.token = ? AND s.expires_at > ?', (token, int(time.time()))).fetchone()
        return dict(row) if row else None
    return db.tx(_q)


def require_user(creds: HTTPAuthorizationCredentials = Depends(bearer)):
    if not creds or not creds.credentials:
        raise HTTPException(401, 'Missing bearer token')
    user = get_user(creds.credentials)
    if not user:
        raise HTTPException(401, 'Invalid or expired token')
    return user


def require_role(*roles):
    def _dep(user: dict = Depends(require_user)):
        if user['role'] not in roles:
            raise HTTPException(403, 'Requires role: ' + '/'.join(roles))
        return user
    return _dep


def public_user(row: dict) -> dict:
    return {k: row.get(k) for k in ('id', 'role', 'phone', 'email', 'name', 'relay_id', 'created_at')}


def admin_passcode() -> str:
    return os.environ.get('RELAY_ADMIN_PASSCODE', 'relay-admin')
