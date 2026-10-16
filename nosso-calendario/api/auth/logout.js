// @ts-check
// POST /api/auth/logout → encerra a sessão neste aparelho.
import { getConfig } from '../_lib/config.js';
import { assertMutationAllowed, handler, methodNotAllowed, sendJson } from '../_lib/http.js';
import { clearSession } from '../_lib/session.js';

export default handler(async (req, res) => {
  if (req.method !== 'POST') throw methodNotAllowed();
  const cfg = getConfig();
  assertMutationAllowed(req, cfg);
  clearSession(req, res, cfg);
  sendJson(res, 200, { ok: true });
});
