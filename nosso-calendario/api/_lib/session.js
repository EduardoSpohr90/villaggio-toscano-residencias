// @ts-check
// Sessão sem banco de dados: os tokens do Google ficam num cookie
// HttpOnly + Secure, cifrado e autenticado com AES-256-GCM. O JavaScript da
// página não consegue ler o cookie (proteção contra XSS roubar tokens).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { parseCookies, setCookie, isSecure } from './http.js';

const VERSION = 1;
export const SESSION_MAX_AGE = 60 * 60 * 24 * 180; // 180 dias
const OAUTH_MAX_AGE = 60 * 10;

/** @param {Buffer} key */
export function seal(data, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify({ v: VERSION, ...data }), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString('base64url');
}

/** @param {Buffer} key */
export function unseal(token, key) {
  try {
    const buf = Buffer.from(String(token), 'base64url');
    if (buf.length < 12 + 16 + 2) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const enc = buf.subarray(12, buf.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    const data = JSON.parse(plain);
    if (!data || data.v !== VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

function names(secure) {
  // Prefixo __Host-: o navegador exige Secure, Path=/ e nenhum Domain.
  return secure
    ? { session: '__Host-nc_session', oauth: '__Host-nc_oauth' }
    : { session: 'nc_session', oauth: 'nc_oauth' };
}

/**
 * @typedef {{ email: string, name: string, person: string, rt: string, at: string,
 *   exp: number, calId?: string, iat: number }} Session
 */

/** @returns {Session | null} */
export function readSession(req, cfg) {
  if (!cfg.sessionKey) return null;
  const n = names(isSecure(req, cfg));
  const raw = parseCookies(req)[n.session];
  if (!raw) return null;
  const s = unseal(raw, cfg.sessionKey);
  if (!s || !s.email || !s.rt) return null;
  if (s.iat && Date.now() / 1000 - s.iat > SESSION_MAX_AGE) return null;
  return s;
}

/** @param {Session} s */
export function writeSession(req, res, cfg, s) {
  const secure = isSecure(req, cfg);
  setCookie(res, names(secure).session, seal(s, cfg.sessionKey), { secure, maxAge: SESSION_MAX_AGE });
}

export function clearSession(req, res, cfg) {
  const secure = isSecure(req, cfg);
  setCookie(res, names(secure).session, '', { secure, maxAge: 0 });
}

export function writeOAuthState(req, res, cfg, data) {
  const secure = isSecure(req, cfg);
  setCookie(res, names(secure).oauth, seal({ ...data, exp: Date.now() + OAUTH_MAX_AGE * 1000 }, cfg.sessionKey), {
    secure,
    maxAge: OAUTH_MAX_AGE,
  });
}

export function readOAuthState(req, cfg) {
  const n = names(isSecure(req, cfg));
  const raw = parseCookies(req)[n.oauth];
  if (!raw || !cfg.sessionKey) return null;
  const s = unseal(raw, cfg.sessionKey);
  if (!s || !s.exp || s.exp < Date.now()) return null;
  return s;
}

export function clearOAuthState(req, res, cfg) {
  const secure = isSecure(req, cfg);
  setCookie(res, names(secure).oauth, '', { secure, maxAge: 0 });
}
