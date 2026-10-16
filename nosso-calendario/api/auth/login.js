// @ts-check
// GET /api/auth/login → redireciona para o consentimento do Google.
import { getConfig, isConfigured } from '../_lib/config.js';
import { handler, redirect, requestOrigin, requestUrl } from '../_lib/http.js';
import { authorizeUrl, pkceChallenge, randomToken } from '../_lib/google.js';
import { writeOAuthState } from '../_lib/session.js';

export default handler(async (req, res) => {
  const cfg = getConfig();
  if (!isConfigured(cfg)) return redirect(res, '/?auth=not_configured');
  const state = randomToken(24);
  const verifier = randomToken(48);
  const hint = requestUrl(req).searchParams.get('hint') || '';
  writeOAuthState(req, res, cfg, { state, verifier });
  redirect(
    res,
    authorizeUrl(cfg, {
      state,
      challenge: pkceChallenge(verifier),
      redirectUri: `${requestOrigin(req, cfg)}/api/auth/callback`,
      loginHint: /^[^\s@]+@[^\s@]+$/.test(hint) ? hint : undefined,
    }),
  );
});
