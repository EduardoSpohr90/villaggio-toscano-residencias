// @ts-check
// OAuth 2.0 (Authorization Code + PKCE, servidor confidencial) e cliente REST
// do Google Calendar. Client secret e refresh token existem apenas aqui.

import { createHash, randomBytes } from 'node:crypto';
import { SCOPES } from './config.js';
import { HttpError } from './http.js';
import { readSession, writeSession, clearSession } from './session.js';

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}
export function pkceChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function authorizeUrl(cfg, { state, challenge, redirectUri, loginHint }) {
  const u = new URL(cfg.authUrl);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent select_account');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (loginHint) u.searchParams.set('login_hint', loginHint);
  return u.toString();
}

async function tokenRequest(cfg, params) {
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params });
  let res;
  try {
    res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (e) {
    throw new HttpError(502, 'google_unreachable', 'Não foi possível falar com o Google agora.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new HttpError(res.status === 400 || res.status === 401 ? 401 : 502, 'token_error', 'Sua conexão com o Google expirou. Entre novamente.');
    /** @type {any} */ (err).google = data.error;
    throw err;
  }
  return data;
}

export function exchangeCode(cfg, code, verifier, redirectUri) {
  return tokenRequest(cfg, { code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' });
}
export function refreshAccessToken(cfg, refreshToken) {
  return tokenRequest(cfg, { refresh_token: refreshToken, grant_type: 'refresh_token' });
}

/**
 * Claims do id_token. Ele chega direto do endpoint de token do Google via TLS
 * (fluxo de código), então a validação de assinatura é dispensável (OIDC Core
 * 3.1.3.7); ainda assim conferimos emissor, audiência, validade e e-mail.
 */
export function decodeIdToken(idToken, cfg) {
  const parts = String(idToken || '').split('.');
  if (parts.length < 2) throw new HttpError(401, 'id_token', 'Não foi possível confirmar sua conta Google.');
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(401, 'id_token', 'Não foi possível confirmar sua conta Google.');
  }
  const issOk = ['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss);
  const audOk = claims.aud === cfg.clientId;
  const expOk = typeof claims.exp === 'number' && claims.exp * 1000 > Date.now() - 60000;
  if (!issOk || !audOk || !expOk || !claims.email || claims.email_verified === false) {
    throw new HttpError(401, 'id_token', 'Não foi possível confirmar sua conta Google.');
  }
  return { email: String(claims.email).toLowerCase(), name: String(claims.name || claims.given_name || '') };
}

export class GoogleError extends HttpError {
  constructor(status, reason, message) {
    super(status, reason, message);
  }
}

/**
 * Chamada REST autenticada à Calendar API.
 * @param {{ cfg: any, token: string }} ctx
 * @param {string} path
 * @param {{ method?: string, query?: Record<string, any>, body?: any, _retried?: boolean }} [opts]
 */
export async function gapi(ctx, path, opts = {}) {
  try {
    return await gapiOnce(ctx, path, opts);
  } catch (e) {
    // Token revogado/expirado antes do previsto: renova uma vez e repete.
    if (e instanceof GoogleError && e.status === 401 && ctx.refresh && !opts._retried) {
      await ctx.refresh();
      return gapiOnce(ctx, path, { ...opts, _retried: true });
    }
    throw e;
  }
}

async function gapiOnce(ctx, path, opts) {
  const url = new URL(ctx.cfg.apiBase + path);
  for (const [k, v] of Object.entries(opts.query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  /** @type {RequestInit} */
  const init = {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${ctx.token}`, Accept: 'application/json' },
  };
  if (opts.body !== undefined) {
    /** @type {any} */ (init.headers)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new GoogleError(502, 'google_unreachable', 'Não foi possível falar com o Google agora.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = (data && data.error && (data.error.errors?.[0]?.reason || data.error.status)) || 'error';
    const msg =
      res.status === 401 ? 'Sua conexão com o Google expirou. Entre novamente.'
      : res.status === 403 ? 'Sem permissão para este calendário.'
      : res.status === 404 || res.status === 410 ? 'Compromisso não encontrado.'
      : res.status === 409 ? 'Este compromisso já existe.'
      : res.status === 429 ? 'Muitas alterações em sequência. Tente em instantes.'
      : 'O Google não respondeu como esperado.';
    console.error('[google]', init.method, path, res.status, reason);
    throw new GoogleError(res.status === 401 ? 401 : res.status, String(reason), msg);
  }
  return data;
}

/**
 * Sessão autenticada para os handlers: valida a lista de pessoas permitidas
 * e renova o access token quando necessário (regravando o cookie).
 */
export async function requireAuth(req, res, cfg) {
  if (!cfg.sessionKey) throw new HttpError(503, 'not_configured', 'O aplicativo ainda não foi configurado.');
  const s = readSession(req, cfg);
  if (!s) throw new HttpError(401, 'unauthenticated', 'Entre com sua conta Google.');
  const person = cfg.allowedUsers.get(s.email);
  if (!person) {
    clearSession(req, res, cfg);
    throw new HttpError(403, 'not_allowed', 'Esta conta não tem acesso ao calendário da família.');
  }
  s.person = person;
  const ctx = {
    cfg,
    token: s.at,
    session: s,
    /** Persiste mudanças (ex.: ID do calendário encontrado). */
    save() {
      writeSession(req, res, cfg, s);
    },
    async refresh() {
      try {
        const t = await refreshAccessToken(cfg, s.rt);
        s.at = t.access_token;
        s.exp = Math.floor(Date.now() / 1000) + Number(t.expires_in || 3600);
        if (t.refresh_token) s.rt = t.refresh_token;
        ctx.token = s.at;
        writeSession(req, res, cfg, s);
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) {
          clearSession(req, res, cfg);
          throw new HttpError(401, 'reauth', 'Sua conexão com o Google expirou. Entre novamente.');
        }
        throw e;
      }
    },
  };
  if (!s.at || !s.exp || s.exp - 60 < Date.now() / 1000) await ctx.refresh();
  return ctx;
}
