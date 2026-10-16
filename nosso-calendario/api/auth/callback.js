// @ts-check
// GET /api/auth/callback → troca o código por tokens (no servidor), confere a
// conta na lista permitida e grava a sessão cifrada.
import { timingSafeEqual } from 'node:crypto';
import { getConfig, isConfigured } from '../_lib/config.js';
import { handler, redirect, requestOrigin, requestUrl } from '../_lib/http.js';
import { decodeIdToken, exchangeCode } from '../_lib/google.js';
import { readOAuthState, clearOAuthState, writeSession } from '../_lib/session.js';

function sameString(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export default handler(async (req, res) => {
  const cfg = getConfig();
  if (!isConfigured(cfg)) return redirect(res, '/?auth=not_configured');
  const params = requestUrl(req).searchParams;
  const saved = readOAuthState(req, cfg);
  clearOAuthState(req, res, cfg);
  if (params.get('error')) return redirect(res, '/?auth=denied');
  const code = params.get('code');
  if (!saved || !code || !sameString(params.get('state') || '', saved.state)) return redirect(res, '/?auth=state');
  let tokens;
  try {
    tokens = await exchangeCode(cfg, code, saved.verifier, `${requestOrigin(req, cfg)}/api/auth/callback`);
  } catch (e) {
    console.error('[auth] troca de código falhou', /** @type {any} */ (e).google || e);
    return redirect(res, '/?auth=failed');
  }
  let who;
  try {
    who = decodeIdToken(tokens.id_token, cfg);
  } catch {
    return redirect(res, '/?auth=failed');
  }
  const person = cfg.allowedUsers.get(who.email);
  if (!person) return redirect(res, '/?auth=not_allowed');
  if (!tokens.refresh_token) return redirect(res, '/?auth=failed');
  writeSession(req, res, cfg, {
    email: who.email,
    name: who.name,
    person,
    rt: tokens.refresh_token,
    at: tokens.access_token,
    exp: Math.floor(Date.now() / 1000) + Number(tokens.expires_in || 3600),
    iat: Math.floor(Date.now() / 1000),
  });
  redirect(res, '/?auth=ok');
});
